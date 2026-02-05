import { prisma } from '../db/prisma';
import { DockerService } from './docker.service';
import { MetroService } from './metro.service';
import { logger } from '../utils/logger';

export class EmulatorService {
    private docker: DockerService;
    private metro: MetroService;

    constructor() {
        this.docker = new DockerService();
        this.metro = new MetroService();
    }

    /**
     * Create emulator session
     */
    async createSession(config: {
        repoId: string;
        userId: string;
        shellId: string;
        shellApkUrl: string;
    }) {
        logger.info(`Creating emulator session for repo ${config.repoId}`);

        // Ensure Metro is running
        const metroUrl = await this.metro.getMetroUrl(config.repoId);
        if (!metroUrl) {
            throw new Error(`Metro bundler not running for repo ${config.repoId}`);
        }

        // Start emulator container
        const { containerId, adbPort } = await this.docker.startEmulator({
            sessionId: crypto.randomUUID(),
            shellApkUrl: config.shellApkUrl,
            metroUrl,
        });

        // Get Metro instance
        const metroInstance = await prisma.metroInstance.findUnique({
            where: { repoId: config.repoId },
        });

        // Create session record
        const session = await prisma.emulatorSession.create({
            data: {
                repoId: config.repoId,
                userId: config.userId,
                shellId: config.shellId,
                metroId: metroInstance?.id,
                containerId,
                containerName: `emulator-${containerId.substring(0, 12)}`,
                adbPort,
                status: 'STARTING',
            },
        });

        logger.info(`Emulator session created: ${session.id}`);

        return session;
    }

    /**
     * Stop emulator session
     */
    async stopSession(sessionId: string) {
        const session = await prisma.emulatorSession.findUnique({
            where: { id: sessionId },
        });

        if (!session) {
            return;
        }

        logger.info(`Stopping emulator session: ${sessionId}`);

        await this.docker.stopContainer(session.containerId);

        await prisma.emulatorSession.update({
            where: { id: sessionId },
            data: {
                status: 'STOPPED',
                stoppedAt: new Date(),
            },
        });
    }

    /**
     * Send input to emulator (tap, swipe, keypress)
     */
    async sendInput(sessionId: string, input: {
        type: 'tap' | 'swipe' | 'key' | 'text';
        x?: number;
        y?: number;
        x2?: number;
        y2?: number;
        key?: string;
        text?: string;
    }) {
        const session = await prisma.emulatorSession.findUnique({
            where: { id: sessionId },
        });

        if (!session || session.status !== 'RUNNING') {
            throw new Error('Session not running');
        }

        logger.info(`Sending ${input.type} input to session ${sessionId}`);

        // Build ADB command
        let adbCommand: string[] = [];

        switch (input.type) {
            case 'tap':
                adbCommand = ['shell', 'input', 'tap', String(input.x), String(input.y)];
                break;
            case 'swipe':
                adbCommand = [
                    'shell',
                    'input',
                    'swipe',
                    String(input.x),
                    String(input.y),
                    String(input.x2),
                    String(input.y2),
                ];
                break;
            case 'key':
                adbCommand = ['shell', 'input', 'keyevent', input.key || ''];
                break;
            case 'text':
                adbCommand = ['shell', 'input', 'text', input.text || ''];
                break;
        }

        // Execute ADB command in container
        await this.docker.execInContainer(session.containerId, ['adb', ...adbCommand]);

        // Update activity timestamp
        await prisma.emulatorSession.update({
            where: { id: sessionId },
            data: {
                lastActivity: new Date(),
                interactionCount: { increment: 1 },
            },
        });
    }

    /**
     * Trigger hot reload on session
     */
    async reloadSession(sessionId: string) {
        const session = await prisma.emulatorSession.findUnique({
            where: { id: sessionId },
            include: { repo: true },
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

        await prisma.emulatorSession.update({
            where: { id: sessionId },
            data: {
                reloadCount: { increment: 1 },
                lastActivity: new Date(),
            },
        });
    }

    /**
     * Cleanup expired sessions
     */
    async cleanupExpired() {
        const maxDuration = 2 * 60 * 60 * 1000; // 2 hours
        const expiredThreshold = new Date(Date.now() - maxDuration);

        const expiredSessions = await prisma.emulatorSession.findMany({
            where: {
                startedAt: {
                    lt: expiredThreshold,
                },
                status: {
                    in: ['RUNNING', 'IDLE'],
                },
            },
        });

        logger.info(`Found ${expiredSessions.length} expired sessions`);

        for (const session of expiredSessions) {
            try {
                await this.stopSession(session.id);
                logger.info(`Stopped expired session ${session.id}`);
            } catch (error) {
                logger.error(`Failed to stop session ${session.id}:`, error);
            }
        }
    }
}
