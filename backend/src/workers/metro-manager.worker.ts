import { Worker } from 'bullmq';
import { MetroService } from '../services/metro.service';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const metroService = new MetroService();

export const metroManagerWorker = new Worker(
    'metro-manager',
    async () => {
        logger.info('Running Metro manager cleanup');

        try {
            await metroService.cleanupIdle();
            return { success: true };
        } catch (error) {
            logger.error('Metro manager failed:', error);
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

metroManagerWorker.on('completed', () => {
    logger.info('Metro cleanup completed');
});
