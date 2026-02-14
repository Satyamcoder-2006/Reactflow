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
export const sessionQueue = new Queue('session-actions', {
    connection,
    defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 500,
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 2000,
        }
    }
});

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

/**
 * Helper to trigger a session start (creates DB record and adds to queue).
 */
export async function triggerSessionStart(params: {
    userId: string;
    repoId: string;
    buildId: string;
    emulatorConfig?: any;
}) {
    const { userId, repoId, buildId, emulatorConfig } = params;
    const { prisma } = await import('../db/prisma');
    const { EventPublisher } = await import('../events/event-publisher');
    const publisher = new EventPublisher(await (await import('../workers/worker-auth')).WorkerContext.getPublisher());

    logger.info(`[session-trigger] Creating session for build ${buildId} (repo: ${repoId})`);

    // 1. Check for existing active session for this user/repo
    const existingSession = await prisma.emulatorSession.findFirst({
        where: {
            repoId,
            userId,
            status: { in: ['STARTING', 'RUNNING'] }
        }
    });

    if (existingSession) {
        logger.info(`[session-trigger] Active session ${existingSession.id} found, reloading.`);
        await publisher.publishSessionReload(existingSession.id, userId, buildId);
        return existingSession;
    }

    // 2. Create session record
    const tempId = `pending-${Math.random().toString(36).substring(2, 9)}`;
    const session = await prisma.emulatorSession.create({
        data: {
            userId,
            repoId,
            buildId, // Link directly to build
            status: 'STARTING',
            containerId: tempId,
            containerName: tempId,
            adbPort: 0,
        } as any
    });

    await publisher.publishSessionStatus(session.id, userId, 'STARTING');

    // 3. Add to queue
    await sessionQueue.add('start-session', {
        sessionId: session.id,
        userId,
        repoId,
        buildId,
        emulatorConfig
    });

    return session;
}

logger.info('✅ Build queues initialized with deduplication');
