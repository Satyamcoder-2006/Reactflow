import { prisma } from '../db/prisma';
import { DockerService } from './docker.service';
import { MetroService } from './metro.service';
import { logger } from '../utils/logger';
import { redis } from '../config/redis';
import crypto from 'crypto';

/** Check ADB connectivity every 30 seconds */
const WATCHDOG_INTERVAL = 30 * 1000;
/** Max ADB failures before restarting emulator */
const MAX_ADB_FAILURES = 3;

export class EmulatorService {
    async cleanupExpiredSessions() {
        const EXPIRE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
        const expired = await prisma.emulatorSession.findMany({
            where: {
                status: 'RUNNING',
                lastActivity: { lt: new Date(Date.now() - EXPIRE_TIMEOUT) },
            },
        });

        for (const session of expired) {
            logger.info(`Cleaning up expired session ${session.id}`);
            await this.stopSession(session.id, 'SYSTEM').catch(() => { });
        }
    }

    private docker: DockerService;
    private metro: MetroService;
    private watchdogs: Map<string, NodeJS.Timeout> = new Map();
    private adbFailures: Map<string, number> = new Map();

    constructor() {
        this.docker = new DockerService();
        this.metro = new MetroService();
    }

    /**
     * Create a new emulator session for a repository.
     */
    async createSession(config: {
        userId: string;
        repoId: string;
        shellId?: string;
        sessionId?: string; // Optional existing session ID
        config?: {
            deviceType?: string;
            androidVersion?: number;
        };
    }) {
        logger.info(`Creating/Initializing emulator session for repo ${config.repoId}`);

        // Ensure Metro is running (optional for demo/initial load)
        let metroUrl = await this.metro.getMetroUrl(config.repoId);
        if (!metroUrl) {
            logger.warn(`Metro bundler not running for repo ${config.repoId}. Using default loopback.`);
            metroUrl = 'http://10.0.2.2:8081'; // Android emulator loopback to host
        }

        // Resolve shell and APK URL if not provided
        let shellId = config.shellId;
        let apkUrl: string | undefined;

        if (!shellId) {
            const latestBuild = await prisma.build.findFirst({
                where: { repoId: config.repoId, status: 'SUCCESS' },
                orderBy: { completedAt: 'desc' },
            });

            if (!latestBuild || !latestBuild.apkUrl) {
                throw new Error('NO_SUCCESSFUL_BUILD');
            }

            shellId = latestBuild.id;
            apkUrl = latestBuild.apkUrl;
        } else {
            // Check if it's a specific Build or a generic Shell
            const build = await prisma.build.findUnique({ where: { id: shellId } });
            if (build && build.apkUrl) {
                apkUrl = build.apkUrl;
            } else {
                const shell = await prisma.shell.findUnique({ where: { id: shellId } });
                if (shell && shell.apkUrl) {
                    apkUrl = shell.apkUrl;
                }
            }

            if (!apkUrl) {
                throw new Error('BUILD_NOT_FOUND');
            }
        }

        const internalSessionId = config.sessionId || crypto.randomUUID();

        // Start emulator container (with isolated networking)
        const { containerId, adbPort } = await this.docker.startEmulator({
            sessionId: internalSessionId,
            shellApkUrl: apkUrl!,
            metroUrl,
        });

        // Get Metro instance
        const metroInstance = await prisma.metroInstance.findUnique({
            where: { repoId: config.repoId },
        });

        // Create or Update session record
        let session;
        const sessionData = {
            repo: { connect: { id: config.repoId } },
            user: { connect: { id: config.userId } },
            build: { connect: { id: shellId } }, // Linking to Build now as per new schema
            metro: metroInstance ? { connect: { id: metroInstance.id } } : undefined,
            containerId,
            containerName: `emulator-${containerId.substring(0, 12)}`,
            adbPort,
            status: 'STARTING',
        } as any;

        if (config.sessionId) {
            session = await prisma.emulatorSession.update({
                where: { id: config.sessionId },
                data: sessionData,
            });
        } else {
            session = await prisma.emulatorSession.create({
                data: sessionData,
            });
        }

        // Start watchdog for this session
        this.startWatchdog(session.id, containerId);

        // Wait for Android boot and install APK in background
        this.waitForBootAndInstallApk(session.id, containerId, apkUrl!).catch(error => {
            logger.error(`Failed to initialize emulator ${session.id}: ${error}`);
        });

        logger.info(`Emulator session created: ${session.id}`);

        return session;
    }

    /**
     * Wait for Android to boot, then install and launch the APK
     */
    private async waitForBootAndInstallApk(sessionId: string, containerId: string, apkPath: string) {
        try {
            logger.info(`Waiting for Android boot on ${sessionId}...`);

            // Wait for boot completion (max 120 seconds)
            const maxWaitTime = 120000;
            const startTime = Date.now();
            let booted = false;

            while (Date.now() - startTime < maxWaitTime) {
                try {
                    const bootStatus = await this.docker.execInContainer(containerId, [
                        'sh', '-c', 'getprop sys.boot_completed'
                    ]);

                    if (bootStatus.trim() === '1') {
                        booted = true;
                        logger.info(`Android booted on ${sessionId}`);
                        break;
                    }
                } catch (error) {
                    // Container might not be ready yet
                }

                await new Promise(resolve => setTimeout(resolve, 3000));
            }

            if (!booted) {
                logger.warn(`Android boot timeout on ${sessionId}, attempting install anyway...`);
            }

            // Update status to installing
            await prisma.emulatorSession.update({
                where: { id: sessionId },
                data: { status: 'INSTALLING_APK' },
            }).catch(() => { });

            // Install the APK
            logger.info(`Installing APK on ${sessionId}: ${apkPath}`);
            const installResult = await this.docker.execInContainer(containerId, [
                'sh', '-c', `pm install -r ${apkPath}`
            ]);

            logger.info(`APK install result: ${installResult}`);

            // List installed third-party packages
            const packages = await this.docker.execInContainer(containerId, [
                'sh', '-c', 'pm list packages -3'
            ]);

            // Extract package name (try common React Native package names first)
            const lines = packages.split('\\n');
            let packageName = lines.find(p => p.includes('com.anonymous') || p.includes('com.reactnativeapp'))
                ?.replace('package:', '').trim();

            if (!packageName && lines.length > 0) {
                packageName = lines[0].replace('package:', '').trim();
            }

            if (!packageName) {
                throw new Error('Could not determine installed package name');
            }

            logger.info(`Launching app ${packageName} on ${sessionId}`);

            // Launch the app
            await this.docker.execInContainer(containerId, [
                'sh', '-c', `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`
            ]);

            // Mark as RUNNING
            await prisma.emulatorSession.update({
                where: { id: sessionId },
                data: { status: 'RUNNING', startedAt: new Date() },
            }).catch(() => { });

            logger.info(`Emulator ${sessionId} is fully initialized and running`);

        } catch (error) {
            logger.error(`Boot/install failed for ${sessionId}: ${error}`);

            await prisma.emulatorSession.update({
                where: { id: sessionId },
                data: { status: 'ERROR' },
            }).catch(() => { });
        }
    }

    /**
     * Stop emulator session and clean up.
     */
    async stopSession(sessionId: string, userId: string | 'SYSTEM') {
        const query = userId === 'SYSTEM'
            ? { where: { id: sessionId } }
            : { where: { id: sessionId, userId } };

        const session = await prisma.emulatorSession.findFirst(query as any);

        if (!session) {
            throw new Error('Session not found');
        }

        logger.info(`Stopping emulator session: ${sessionId}`);

        // Stop watchdog
        this.stopWatchdog(sessionId);
        this.adbFailures.delete(sessionId);

        // Stop Docker container
        try {
            await this.docker.stopContainer(session.containerId);
        } catch (error) {
            logger.error(`Failed to stop container ${session.containerId}: ${error}`);
        }

        // Update session status
        await prisma.emulatorSession.update({
            where: { id: sessionId },
            data: {
                status: 'STOPPED',
                stoppedAt: new Date(),
            },
        });
    }

    /**
     * Send input to emulator.
     */
    async sendInput(sessionId: string, userId: string, input: any) {
        const session = await prisma.emulatorSession.findFirst({
            where: { id: sessionId, userId },
        });

        if (!session || session.status !== 'RUNNING') {
            throw new Error('Session not running');
        }

        logger.info(`Sending ${input.type} input to session ${sessionId}`);

        // Build ADB command
        let adbCommand: string[] = [];

        switch (input.type) {
            case 'tap':
                adbCommand = ['input', 'tap', String(input.x), String(input.y)];
                break;
            case 'swipe':
                adbCommand = [
                    'input',
                    'swipe',
                    String(input.x),
                    String(input.y),
                    String(input.x2),
                    String(input.y2),
                ];
                break;
            case 'key':
                adbCommand = ['input', 'keyevent', input.key || ''];
                break;
            case 'text':
                adbCommand = ['input', 'text', input.text || ''];
                break;
        }

        await this.docker.execInContainer(session.containerId, adbCommand);

        // Update activity timestamp
        await prisma.emulatorSession.update({
            where: { id: sessionId },
            data: {
                lastActivity: new Date(),
                interactionCount: { increment: 1 },
            } as any,
        });
    }

    /**
     * Trigger hot reload on session.
     */
    async reloadSession(sessionId: string, userId: string) {
        const session = await prisma.emulatorSession.findFirst({
            where: { id: sessionId, userId },
            include: { repo: true } as any,
        });

        if (!session) {
            throw new Error('Session not found');
        }

        logger.info(`Triggering reload for session ${sessionId}`);

        // Trigger Metro reload
        await this.metro.triggerHotReload(session.repoId);

        // Send reload key to emulator (R+R for React Native dev menu)
        await this.docker.execInContainer(session.containerId, [
            'adb',
            'shell',
            'input',
            'keyevent',
            'KEYCODE_R',
            'KEYCODE_R',
        ]);
    }

    /**
     * Get screenshot from emulator.
     */
    async getScreenshot(sessionId: string, userId: string): Promise<Buffer> {
        const session = await prisma.emulatorSession.findFirst({
            where: { id: sessionId, userId },
        });

        if (!session || session.status !== 'RUNNING') {
            throw new Error('Session not running');
        }

        return this.docker.getScreenshot(session.containerId);
    }

    /**
     * Get JPEG screenshot from emulator.
     */
    async getScreenshotJpeg(sessionId: string, userId: string): Promise<Buffer> {
        const session = await prisma.emulatorSession.findFirst({
            where: { id: sessionId, userId },
        });

        if (!session || session.status !== 'RUNNING') {
            throw new Error('Session not running');
        }

        return this.docker.getScreenshotJpeg(session.containerId);
    }

    private startWatchdog(sessionId: string, containerId: string) {
        if (this.watchdogs.has(sessionId)) return;

        const interval = setInterval(async () => {
            try {
                // Check if container is still running
                const isRunning = await this.docker.isContainerRunning(containerId);
                if (!isRunning) {
                    logger.warn(`Container ${containerId} stopped for session ${sessionId}`);
                    this.stopSession(sessionId, 'SYSTEM').catch(() => { });
                    return;
                }

                // Check ADB connectivity
                const adbOutput = await this.docker.execInContainer(containerId, ['adb', 'devices']);
                if (!adbOutput.includes('device')) {
                    const failures = (this.adbFailures.get(sessionId) || 0) + 1;
                    this.adbFailures.set(sessionId, failures);
                    logger.warn(`ADB failure for session ${sessionId} (${failures}/${MAX_ADB_FAILURES})`);

                    if (failures >= MAX_ADB_FAILURES) {
                        logger.error(`Critical ADB failure for session ${sessionId}. Restarting...`);
                        // Logic to restart emulator would go here
                    }
                } else {
                    this.adbFailures.set(sessionId, 0);
                }
            } catch (error) {
                logger.error(`Watchdog error for session ${sessionId}: ${error}`);
            }
        }, WATCHDOG_INTERVAL);

        this.watchdogs.set(sessionId, interval);
    }

    private stopWatchdog(sessionId: string) {
        const interval = this.watchdogs.get(sessionId);
        if (interval) {
            clearInterval(interval);
            this.watchdogs.delete(sessionId);
        }
    }
}

export const emulatorService = new EmulatorService();
