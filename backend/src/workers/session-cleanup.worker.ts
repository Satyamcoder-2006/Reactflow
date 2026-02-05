import { Worker } from 'bullmq';
import { EmulatorService } from '../services/emulator.service';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const emulatorService = new EmulatorService();

export const sessionCleanupWorker = new Worker(
    'session-cleanup',
    async () => {
        logger.info('Running emulator session cleanup');

        try {
            await emulatorService.cleanupExpired();
            return { success: true };
        } catch (error) {
            logger.error('Session cleanup failed:', error);
            throw error;
        }
    },
    {
        connection: {
            host: env.REDIS_HOST,
            port: Number(env.REDIS_PORT),
        },
    }
);

sessionCleanupWorker.on('completed', () => {
    logger.info('Session cleanup completed');
});
