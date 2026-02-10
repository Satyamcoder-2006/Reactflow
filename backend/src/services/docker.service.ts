import Docker from 'dockerode';
import { EventEmitter } from 'events';
import path from 'path';
import { logger } from '../utils/logger';
import { env } from '../config/env';

export class DockerService extends EventEmitter {
    private docker: Docker;

    constructor() {
        super();
        this.docker = new Docker();
    }

    /**
     * Build shell APK in Docker container with persistent cache volumes.
     */
    async buildShellAPK(config: {
        repoUrl: string;
        branch: string;
        commit: string;
        buildId: string;
    }): Promise<string> {
        const containerName = `build-${config.buildId}`;

        logger.info(`Creating build container: ${containerName}`);

        const container = await this.docker.createContainer({
            Image: 'android-builder:latest',
            name: containerName,
            Env: [
                `REPO_URL=${config.repoUrl}`,
                `BRANCH=${config.branch}`,
                `COMMIT=${config.commit}`,
                `BUILD_ID=${config.buildId}`,
                `BACKEND_URL=${env.BACKEND_URL}`,
            ],
            HostConfig: {
                Memory: 4 * 1024 * 1024 * 1024, // 4GB
                CpuQuota: 400000, // 4 cores
                Binds: [
                    // Persistent Gradle cache across builds (per-repo isolation available)
                    `${env.GRADLE_CACHE_PATH}:/cache/gradle`,
                    `${env.NPM_CACHE_PATH}:/root/.npm`,
                    // Mount uploads directory so container can save APK directly
                    `${path.join(process.cwd(), 'uploads')}:/app/uploads`,
                ],
                AutoRemove: false,
            },
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

        // Get APK URL
        const apkUrl = `${env.BACKEND_URL}/storage/shells/${config.commit}/app-debug.apk`;

        // Cleanup container
        logger.info(`Removing build container: ${containerName}`);
        await container.remove();

        if (result.StatusCode !== 0) {
            throw new Error(`Build failed with exit code ${result.StatusCode}`);
        }

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
            Image: 'redroid:latest',
            name: containerName,
            Env: [`METRO_URL=${config.metroUrl}`, `SHELL_APK_URL=${config.shellApkUrl}`],
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
        const container = this.docker.getContainer(containerId);

        const exec = await container.exec({
            Cmd: cmd,
            AttachStdout: true,
            AttachStderr: true,
        });

        const stream = await exec.start({ Detach: false });

        return new Promise((resolve, reject) => {
            let output = '';

            stream.on('data', (chunk: Buffer) => {
                output += chunk.toString('utf8');
            });

            stream.on('end', () => {
                resolve(output);
            });

            stream.on('error', reject);
        });
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
