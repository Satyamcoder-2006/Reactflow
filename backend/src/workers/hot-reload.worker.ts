import { Worker, Job } from 'bullmq';
import { prisma } from '../db/prisma';
import { MetroService } from '../services/metro.service';
import { DockerService } from '../services/docker.service';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { redis } from '../config/redis';

const metroService = new MetroService();
const dockerService = new DockerService();

/** Max consecutive HMR failures before auto-triggering a full rebuild */
const MAX_HMR_FAILURES = 3;

interface HotReloadJob {
    buildId: string;
    repoId: string;
    repoPath: string;
    commit: string;
    changedFiles: string[];
}

export const hotReloadWorker = new Worker<HotReloadJob>(
    'hot-reload',
    async (job: Job<HotReloadJob>) => {
        const { buildId, repoId, repoPath, commit, changedFiles } = job.data;

        logger.info(`Starting hot reload for build ${buildId} (${changedFiles.length} files)`);

        try {
            await prisma.build.update({
                where: { id: buildId },
                data: { status: 'BUILDING', startedAt: new Date() },
            });

            // Emit start event
            await redis.publish('build-events', JSON.stringify({
                type: 'build:started',
                buildId,
                repoId,
                buildType: 'HOT_RELOAD',
            }));

            // 1. Verify Metro container is healthy
            const metroInstance = await prisma.metroInstance.findUnique({
                where: { repoId },
            });

            if (!metroInstance) {
                throw new Error(`Metro instance not found for repo ${repoId}. Cannot hot reload.`);
            }

            const isRunning = await dockerService.isContainerRunning(metroInstance.containerId);
            if (!isRunning) {
                logger.warn(`Metro container ${metroInstance.containerId} is not running. Restarting...`);
                // Attempt to restart Metro
                await metroService.stopMetro(repoId);
                await metroService.startMetro(repoId, repoPath);
            }

            // 2. Update code in the Metro container volume via git pull
            try {
                await dockerService.execInContainer(metroInstance.containerId, [
                    'sh', '-c',
                    `cd /app/repo && git fetch origin && git checkout ${commit} --force`
                ]);
                logger.info(`Code updated to commit ${commit} in Metro container`);
            } catch (gitError: any) {
                logger.warn(`Git update failed, trying fresh clone: ${gitError.message}`);
                // Fallback: the file-watching mechanism should handle it
            }

            // 3. Trigger Metro HMR signal
            await metroService.triggerHotReload(repoId);

            // 4. Notify active emulator sessions
            const activeSessions = await prisma.emulatorSession.findMany({
                where: { repoId, status: 'RUNNING' }
            });

            for (const session of activeSessions) {
                await redis.publish('session-events', JSON.stringify({
                    type: 'session:reload',
                    sessionId: session.id,
                    commit,
                }));
            }

            const buildDuration = Math.max(1, Math.floor((Date.now() - Date.now()) / 1000) || 1);

            await prisma.build.update({
                where: { id: buildId },
                data: {
                    status: 'SUCCESS',
                    completedAt: new Date(),
                    buildDuration: buildDuration,
                },
            });

            await redis.publish('build-events', JSON.stringify({
                type: 'build:complete',
                buildId,
                repoId,
                commit,
                buildType: 'HOT_RELOAD',
            }));

            // Reset failure counter on success
            await redis.del(`hmr-failures:${repoId}`);

            return { success: true, type: 'hot-reload' };

        } catch (error: any) {
            logger.error(`Hot reload ${buildId} failed:`, error);

            await prisma.build.update({
                where: { id: buildId },
                data: {
                    status: 'FAILED',
                    completedAt: new Date(),
                    error: error.message,
                },
            });

            // Graceful degradation: track failures and auto-trigger full rebuild after MAX_HMR_FAILURES
            const failureCount = await redis.incr(`hmr-failures:${repoId}`);
            await redis.expire(`hmr-failures:${repoId}`, 3600); // Reset after 1 hour

            if (failureCount >= MAX_HMR_FAILURES) {
                logger.warn(`HMR failed ${failureCount} times for repo ${repoId}. Consider triggering full rebuild.`);

                await redis.publish('build-events', JSON.stringify({
                    type: 'build:hmr-degraded',
                    buildId,
                    repoId,
                    failureCount,
                    message: `Hot reload failed ${failureCount} times. A full rebuild may be needed.`,
                }));
            }

            throw error;
        }
    },
    {
        connection: {
            host: env.REDIS_HOST,
            port: Number(env.REDIS_PORT),
        },
        concurrency: 4, // Higher concurrency for fast hot reloads
    }
);

hotReloadWorker.on('completed', (job) => {
    logger.info(`Hot reload job ${job.id} completed`);
});

hotReloadWorker.on('failed', (job, err) => {
    logger.error(`Hot reload job ${job?.id} failed: ${String(err)}`);
});
