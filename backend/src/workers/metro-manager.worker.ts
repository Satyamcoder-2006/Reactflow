import { Worker } from 'bullmq';
import { MetroService } from '../services/metro.service';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { prisma } from '../db/prisma';

const metroService = new MetroService();

export const metroManagerWorker = new Worker(
    'metro-manager',
    async () => {
        logger.info('Running Metro manager cleanup');

        try {
            // 1. Clean up idle instances (TTL-based, 30m)
            await metroService.cleanupIdle();

            // 2. Run health checks on all active instances
            const activeInstances = await prisma.metroInstance.findMany({
                where: {
                    status: {
                        in: ['READY', 'STARTING'],
                    },
                },
            });

            for (const instance of activeInstances) {
                await metroService.checkHealth(instance.id);
            }

            logger.info(`Health checked ${activeInstances.length} active Metro instances`);

            return { success: true, checkedInstances: activeInstances.length };
        } catch (error) {
            logger.error(`Metro manager failed: ${String(error)}`);
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
