// Worker index - starts all BullMQ workers
import { shellBuilderWorker } from './shell-builder.worker';
import { hotReloadWorker } from './hot-reload.worker';
import { metroManagerWorker } from './metro-manager.worker';
import { sessionCleanupWorker } from './session-cleanup.worker';
import { metroManagerQueue, sessionCleanupQueue } from '../queues/build.queue';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// Re-export queues from the centralized module for backward compat
export {
    shellBuildQueue,
    hotReloadQueue,
    metroManagerQueue,
    sessionCleanupQueue,
    addShellBuildJob,
    addHotReloadJob,
} from '../queues/build.queue';

logger.info('✅ All workers initialized');
logger.info('Workers running:');
logger.info('  - shell-builder (concurrency: ' + env.BUILD_CONCURRENCY + ')');
logger.info('  - hot-reload');
logger.info('  - metro-manager (scheduled)');
logger.info('  - session-cleanup (scheduled)');

// Schedule periodic cleanup jobs (every 10 minutes)
setInterval(async () => {
    await metroManagerQueue.add('cleanup', {}, { repeat: { every: 600000 } });
    await sessionCleanupQueue.add('cleanup', {}, { repeat: { every: 600000 } });
}, 600000);

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, closing workers...');
    await shellBuilderWorker.close();
    await hotReloadWorker.close();
    await metroManagerWorker.close();
    await sessionCleanupWorker.close();
    process.exit(0);
});
