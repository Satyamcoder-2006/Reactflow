import { FastifyInstance } from 'fastify';
import { shellBuildQueue, hotReloadQueue } from '../queues/build.queue';
import { authenticateUser } from '../middleware/auth.middleware';

export async function adminRoutes(app: FastifyInstance) {
    // Only allow authenticated users for now
    app.addHook('onRequest', authenticateUser);

    app.get('/queue-stats', async (request, reply) => {
        const [
            shellWaiting, shellActive, shellCompleted, shellFailed,
            hotWaiting, hotActive, hotCompleted, hotFailed
        ] = await Promise.all([
            shellBuildQueue.getWaitingCount(),
            shellBuildQueue.getActiveCount(),
            shellBuildQueue.getCompletedCount(),
            shellBuildQueue.getFailedCount(),
            hotReloadQueue.getWaitingCount(),
            hotReloadQueue.getActiveCount(),
            hotReloadQueue.getCompletedCount(),
            hotReloadQueue.getFailedCount()
        ]);

        const shellWorkers = await shellBuildQueue.getWorkers();
        const hotWorkers = await hotReloadQueue.getWorkers();

        return {
            queues: {
                shell: {
                    waiting: shellWaiting,
                    active: shellActive,
                    completed: shellCompleted,
                    failed: shellFailed,
                    workers: shellWorkers.length,
                    status: shellWorkers.length > 0 ? 'healthy' : 'degraded'
                },
                hotReload: {
                    waiting: hotWaiting,
                    active: hotActive,
                    completed: hotCompleted,
                    failed: hotFailed,
                    workers: hotWorkers.length,
                    status: hotWorkers.length > 0 ? 'healthy' : 'degraded'
                }
            },
            timestamp: new Date().toISOString()
        };
    });
}
