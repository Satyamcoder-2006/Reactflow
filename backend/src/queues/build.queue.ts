import { Queue, QueueEvents } from 'bullmq';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const connection = {
    host: env.REDIS_HOST,
    port: Number(env.REDIS_PORT),
};

// ==================== QUEUE INSTANCES ====================

export const shellBuildQueue = new Queue('shell-build', {
    connection,
    defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 1000,
        attempts: 2,
        backoff: {
            type: 'exponential',
            delay: 5000,
        },
    },
});

export const hotReloadQueue = new Queue('hot-reload', {
    connection,
    defaultJobOptions: {
        removeOnComplete: 200,
        removeOnFail: 500,
        attempts: 3,
        backoff: {
            type: 'fixed',
            delay: 1000,
        },
        priority: 1, // Higher priority than builds
    },
});

export const metroManagerQueue = new Queue('metro-manager', { connection });
export const sessionCleanupQueue = new Queue('session-cleanup', { connection });

// ==================== DEDUPLICATION ====================

/**
 * Add a shell build job with deduplication.
 * Cancels any pending (waiting) builds for the same repo before adding a new one.
 */
export async function addShellBuildJob(data: {
    buildId: string;
    repoId: string;
    userId: string;
    repoUrl: string;
    branch: string;
    commit: string;
    packageJson?: any;
    dependencyHash?: string;
    autoStartSession?: boolean;
    emulatorConfig?: {
        deviceType: string;
        androidVersion: number;
    };
}) {
    const jobId = `shell-build-${data.repoId}-${data.commit}`;

    // Remove any waiting jobs for the same repo (dedup)
    const waitingJobs = await shellBuildQueue.getJobs(['waiting', 'delayed']);
    for (const job of waitingJobs) {
        if (job.data?.repoId === data.repoId && job.id !== jobId) {
            logger.info(`Dedup: Removing stale build job ${job.id} for repo ${data.repoId}`);
            await job.remove().catch(() => { /* job may have already started */ });
        }
    }

    return shellBuildQueue.add('shell-build', data, { jobId });
}

/**
 * Add a hot reload job with deduplication.
 * Only the latest JS change matters — remove older pending hot reloads for same repo.
 */
export async function addHotReloadJob(data: {
    buildId: string;
    repoId: string;
    repoPath: string;
    commit: string;
    changedFiles: string[];
}) {
    const jobId = `hot-reload-${data.repoId}-${data.commit}`;

    // Remove any waiting hot reload jobs for the same repo
    const waitingJobs = await hotReloadQueue.getJobs(['waiting', 'delayed']);
    for (const job of waitingJobs) {
        if (job.data?.repoId === data.repoId && job.id !== jobId) {
            logger.info(`Dedup: Removing stale hot-reload job ${job.id} for repo ${data.repoId}`);
            await job.remove().catch(() => { });
        }
    }

    return hotReloadQueue.add('hot-reload', data, { jobId });
}

logger.info('✅ Build queues initialized with deduplication');
