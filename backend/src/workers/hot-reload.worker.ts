import { Worker, Job } from 'bullmq';
import { prisma } from '../db/prisma';
import { MetroService } from '../services/metro.service';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { redis } from '../config/redis';

// We need to implement MetroService first, but I'll define the worker assuming its interface
// This resolves the circular dependency mental block
const metroService = new MetroService();

interface HotReloadJob {
    buildId: string;
    repoId: string;
    repoPath: string; // Path where repo is cloned/mounted
    commit: string;
    changedFiles: string[];
}

export const hotReloadWorker = new Worker<HotReloadJob>(
    'hot-reload',
    async (job: Job<HotReloadJob>) => {
        const { buildId, repoId, repoPath, commit, changedFiles } = job.data;

        logger.info(`Starting hot reload for build ${buildId}`);

        try {
            await prisma.build.update({
                where: { id: buildId },
                data: { status: 'BUILDING', startedAt: new Date() },
            });

            // 1. Update the code in the Metro container volume
            // In a real prod env, we might git pull inside the volume or sync files
            // For MVP, if we reuse the volume, we might need a quick git fetch/checkout interaction
            // Here we assume the Repo path is shared and we update it.

            // This is a placeholder for the actual git update logic on the shared volume
            // await gitUpdate(repoPath, commit); 

            // 2. Trigger Metro update / signal
            // Metro usually watches files, so updating the file system might be enough.
            // But we might want to force a bundle graph refresh if needed.

            await metroService.triggerHotReload(repoId);

            // 3. Notify active sessions
            const activeSessions = await prisma.emulatorSession.findMany({
                where: { repoId, status: 'RUNNING' }
            });

            for (const session of activeSessions) {
                // Send reload command to emulator via ADB or simplified reload signal
                await redis.publish('session-events', JSON.stringify({
                    type: 'session:reload',
                    sessionId: session.id
                }));
            }

            await prisma.build.update({
                where: { id: buildId },
                data: {
                    status: 'SUCCESS',
                    completedAt: new Date(),
                    buildDuration: 1 // fast!
                },
            });

            await redis.publish('build-events', JSON.stringify({
                type: 'build:complete',
                buildId,
                commit
            }));

            return { success: true, type: 'hot-reload' };

        } catch (error: any) {
            logger.error(`Hot reload ${buildId} failed:`, error);
            await prisma.build.update({
                where: { id: buildId },
                data: {
                    status: 'FAILED',
                    completedAt: new Date(),
                    error: error.message
                },
            });
            throw error;
        }
    },
    {
        connection: {
            host: env.REDIS_HOST,
            port: Number(env.REDIS_PORT),
        }
    }
);
