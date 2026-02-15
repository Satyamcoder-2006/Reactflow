import Docker from 'dockerode';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs-extra';
import { PassThrough } from 'stream';
import { logger } from '../utils/logger';
import { env } from '../config/env';

export class DockerService extends EventEmitter {
    private docker: Docker;

    constructor() {
        super();
        this.docker = new Docker();
    }

    // ... existing code ...

    /**
     * Execute command in container and return Buffer (stdout only).
     */
    async execInContainerBuffer(containerId: string, cmd: string[]): Promise<Buffer> {
        const container = this.docker.getContainer(containerId);

        const exec = await container.exec({
            Cmd: cmd,
            AttachStdout: true,
            AttachStderr: true,
        });

        const stream = await exec.start({ Detach: false });

        return new Promise((resolve, reject) => {
            const stdout = new PassThrough();
            const stderr = new PassThrough(); // Drain stderr
            const chunks: Buffer[] = [];

            container.modem.demuxStream(stream, stdout, stderr);

            stdout.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });

            stdout.on('end', () => {
                resolve(Buffer.concat(chunks));
            });

            stream.on('error', reject);
        });
    }

    /**
     * Get screenshot from emulator container.
     */
    async getScreenshot(containerId: string): Promise<Buffer> {
        // Run screencap directly inside container
        return this.execInContainerBuffer(containerId, ['screencap', '-p']);
    }

    /**
     * Build shell APK in Docker container with persistent cache volumes.
     */
    async buildShellAPK(config: {
        repoId: string;
        repoUrl: string;
        branch: string;
        commit: string;
        buildId: string;
    }): Promise<string> {
        const containerName = `build-${config.buildId}`;

        logger.info(`Creating build container: ${containerName}`);

        const uploadsPath = path.join(process.cwd(), 'uploads/shells');
        const outputDir = path.join(uploadsPath, config.repoId, config.commit);
        await fs.ensureDir(outputDir);

        const scriptPath = path.resolve(__dirname, '../../../docker/build-shell.sh');

        const container = await this.docker.createContainer({
            Image: 'android-builder:latest',
            name: containerName,
            Env: [
                `REPO_ID=${config.repoId}`,
                `REPO_URL=${config.repoUrl}`,
                `BRANCH=${config.branch}`,
                `COMMIT=${config.commit}`,
                `BUILD_ID=${config.buildId}`,
            ],
            HostConfig: {
                Memory: 4 * 1024 * 1024 * 1024, // 4GB
                CpuQuota: 400000, // 4 cores
                Binds: [
                    `${env.GRADLE_CACHE_PATH}:/root/.gradle`,
                    `${env.NPM_CACHE_PATH}:/root/.npm`,
                    // Mount specific host output dir to container /output/repo/commit
                    `${outputDir}:/output/${config.repoId}/${config.commit}`,
                    // Mount the build script
                    `${scriptPath}:/usr/local/bin/build-shell.sh:ro`,
                ],
                AutoRemove: false, // Keep for debugging
            },
            Cmd: ['/bin/bash', '/usr/local/bin/build-shell.sh'],
        });

        // Attach to container output
        const stream = await container.attach({
            stream: true,
            stdout: true,
            stderr: true,
        });

        stream.on('data', (chunk: Buffer) => {
            const log = chunk.toString('utf8');
            this.emit('log', { buildId: config.buildId, message: log });
        });

        // Start container
        logger.info(`Starting build container: ${containerName}`);
        await container.start();

        // Wait for completion
        const result = await container.wait();

        // Cleanup container since AutoRemove is false
        logger.info(`Removing build container: ${containerName}`);
        await container.remove().catch(err => logger.warn(`Failed to remove container ${containerName}: ${err}`));

        if (result.StatusCode !== 0) {
            throw new Error(`Build failed with exit code ${result.StatusCode}`);
        }

        // Return local URL prefix
        const apkUrl = `/storage/shells/${config.repoId}/${config.commit}/shell.apk`;

        return apkUrl;
    }

    /**
     * Start Metro bundler container.
     */
    async startMetro(config: {
        repoId: string;
        repoPath: string;
    }): Promise<{ containerId: string; httpPort: number; wsPort: number }> {
        const containerName = `metro-${config.repoId}`;

        logger.info(`Creating Metro container: ${containerName}`);

        const container = await this.docker.createContainer({
            Image: 'metro-server:latest',
            name: containerName,
            Env: [`REPO_PATH=${config.repoPath}`],
            ExposedPorts: {
                '8081/tcp': {},
                '8082/tcp': {},
            },
            HostConfig: {
                PortBindings: {
                    '8081/tcp': [{ HostPort: '0' }], // Random port
                    '8082/tcp': [{ HostPort: '0' }],
                },
                Binds: [`${config.repoPath}:/app/repo`], // Writable for git pull
                Memory: 2 * 1024 * 1024 * 1024, // 2GB limit for Metro
                CpuQuota: 200000, // 2 cores
            },
        });

        await container.start();

        const inspect = await container.inspect();
        const httpPort = parseInt(inspect.NetworkSettings.Ports['8081/tcp'][0].HostPort);
        const wsPort = parseInt(inspect.NetworkSettings.Ports['8082/tcp'][0].HostPort);

        logger.info(`Metro started: ${containerName} (HTTP:${httpPort}, WS:${wsPort})`);

        return {
            containerId: container.id,
            httpPort,
            wsPort,
        };
    }

    /**
     * Start Redroid emulator with isolated networking.
     */
    async startEmulator(config: {
        sessionId: string;
        shellApkUrl: string;
        metroUrl: string;
    }): Promise<{ containerId: string; adbPort: number }> {
        const containerName = `emulator-${config.sessionId}`;

        logger.info(`Creating emulator container: ${containerName}`);

        // Create isolated Docker network for this session
        let networkId: string | undefined;
        const networkName = `preview-${config.sessionId}`;
        try {
            const network = await this.docker.createNetwork({
                Name: networkName,
                Driver: 'bridge',
                Labels: { sessionId: config.sessionId },
            });
            networkId = network.id;
            logger.info(`Created isolated network: ${networkName}`);
        } catch (error) {
            logger.warn(`Failed to create isolated network, using default bridge`);
        }


        const containerConfig: Docker.ContainerCreateOptions = {
            Image: 'redroid/redroid:12.0.0-latest', // Updated for better WSL2 compatibility
            name: containerName,
            Env: [
                `METRO_URL=${config.metroUrl}`,
                `SHELL_APK_URL=${config.shellApkUrl}`,
                'REDROID_GPU_MODE=auto',  // Auto-detect best GPU mode
                'REDROID_WIDTH=1080',
                'REDROID_HEIGHT=2400',
                'REDROID_FPS=30',
                'REDROID_DPI=480',
                'ro.kernel.qemu=1',  // Helps with emulator detection
                'qemu.hw.mainkeys=0'  // Enable software navigation
            ],
            ExposedPorts: {
                '5555/tcp': {}, // ADB
            },
            HostConfig: {
                Privileged: true,
                PortBindings: {
                    '5555/tcp': [{ HostPort: '0' }],
                },
                Memory: 2 * 1024 * 1024 * 1024, // 2GB limit
                CpuQuota: 200000, // 2 CPU cores
                ...(networkId ? { NetworkMode: networkName } : {}),
            },
        };

        const container = await this.docker.createContainer(containerConfig);

        await container.start();

        const inspect = await container.inspect();
        const adbPort = parseInt(inspect.NetworkSettings.Ports['5555/tcp'][0].HostPort);

        logger.info(`Emulator started: ${containerName} (ADB:${adbPort})`);

        return {
            containerId: container.id,
            adbPort,
        };
    }

    /**
     * Stop and remove container.
     */
    async stopContainer(containerId: string) {
        try {
            const container = this.docker.getContainer(containerId);
            logger.info(`Stopping container: ${containerId}`);
            await container.stop({ t: 10 }); // 10 second timeout
            await container.remove();
            logger.info(`Container removed: ${containerId}`);
        } catch (error) {
            logger.error(`Failed to stop container ${containerId}: ${String(error)}`);
            // Try force remove
            try {
                const container = this.docker.getContainer(containerId);
                await container.remove({ force: true });
            } catch (removeError) {
                // Container may already be gone
            }
        }
    }

    /**
     * Execute command in container.
     */
    async execInContainer(containerId: string, cmd: string[]): Promise<string> {
        const buffer = await this.execInContainerBuffer(containerId, cmd);
        return buffer.toString('utf8');
    }

    /**
     * Execute command in container and return Buffer.
     */
    async execInContainerBuffer(containerId: string, cmd: string[]): Promise<Buffer> {
        const container = this.docker.getContainer(containerId);

        const exec = await container.exec({
            Cmd: cmd,
            AttachStdout: true,
            AttachStderr: true,
        });

        const stream = await exec.start({ Detach: false });

        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];

            stream.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });

            stream.on('end', () => {
                resolve(Buffer.concat(chunks));
            });

            stream.on('error', reject);
        });
    }

    /**
     * Get screenshot from emulator container.
     */
    async getScreenshot(containerId: string): Promise<Buffer> {
        // Use adb shell screencap -p to get PNG
        return this.execInContainerBuffer(containerId, ['adb', 'shell', 'screencap', '-p']);
    }

    /**
     * Get screenshot from emulator container as JPEG (compressed).
     */
    async getScreenshotJpeg(containerId: string, quality: number = 80): Promise<Buffer> {
        const pngBuffer = await this.getScreenshot(containerId);
        try {
            // Lazy load sharp to avoid startup issues if not installed
            const sharp = require('sharp');
            return await sharp(pngBuffer)
                .jpeg({ quality, mozjpeg: true })
                .toBuffer();
        } catch (error) {
            logger.warn(`Sharp optimization failed, falling back to PNG: ${error}`);
            return pngBuffer;
        }
    }

    /**
     * Check if container is running.
     */
    async isContainerRunning(containerId: string): Promise<boolean> {
        try {
            const container = this.docker.getContainer(containerId);
            const info = await container.inspect();
            return info.State.Running;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get container logs.
     */
    async getContainerLogs(containerId: string, tail: number = 100): Promise<string> {
        const container = this.docker.getContainer(containerId);

        const logs = await container.logs({
            stdout: true,
            stderr: true,
            tail,
        });

        return logs.toString('utf8');
    }

    /**
     * Remove Docker network by name.
     */
    async removeNetwork(networkName: string) {
        try {
            const network = this.docker.getNetwork(networkName);
            await network.remove();
            logger.info(`Network removed: ${networkName}`);
        } catch (error) {
            logger.warn(`Failed to remove network ${networkName}`);
        }
    }
}
