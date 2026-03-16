import { Worker, Job } from 'bullmq';
import { WorkerContext } from './worker-auth';
import { EventPublisher } from '../events/event-publisher';
import { BuildEvent, BuildEventType } from '../events/event-types';
import { DockerService } from '../services/docker.service';
import { emulatorService } from '../services/emulator.service';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import path from 'path';
import fs from 'fs-extra';

// Initialize context ONCE
WorkerContext.initialize().catch(err => {
    logger.error('Failed to initialize worker context:', err);
    process.exit(1);
});

const dockerService = new DockerService();

/** Resolve Android package name for a repo; falls back to 'com.anonymous'. */
async function getPackageNameFromManifest(repoId: string): Promise<string> {
    const prisma = WorkerContext.getPrisma();
    const repo = await prisma.repo.findUnique({ where: { id: repoId } });
    // If a packageName field is stored on the repo, use it
    const storedName = (repo as any)?.packageName as string | undefined;
    if (storedName) return storedName;
    logger.warn(`[shell-builder] No packageName for repo ${repoId}, using com.anonymous`);
    return 'com.anonymous';
}

interface ShellBuildJob {
    buildId: string;
    repoId: string;
    userId: string;
    repoUrl: string;
    branch: string;
    commit: string;
    autoStartSession?: boolean;
    emulatorConfig?: any;
}

export const shellBuilderWorker = new Worker<ShellBuildJob>(
    'shell-build',
    async (job: Job<ShellBuildJob>) => {
        const { buildId, repoId, userId, repoUrl, branch, commit, autoStartSession, emulatorConfig } = job.data;
        const prisma = WorkerContext.getPrisma();
        const publisher = new EventPublisher(WorkerContext.getPublisher());

        logger.info(`[shell-builder] Starting build ${buildId} for commit ${commit}`);

        try {
            // Guard: check if the build record still exists (e.g. DB was reset)
            const existingBuild = await prisma.build.findUnique({ where: { id: buildId } });
            if (!existingBuild) {
                logger.warn(`[shell-builder] Build ${buildId} not found in DB — skipping stale job.`);
                return { success: false, skipped: true };
            }

            // Update status to BUILDING
            await prisma.build.update({
                where: { id: buildId },
                data: { status: 'BUILDING', startedAt: new Date() },
            });

            await publisher.publishBuildStatus(buildId, userId, repoId, 'BUILDING');

            // Log Batching Logic
            const logBuffer: string[] = [];
            const BATCH_SIZE = 15;
            let batchTimeout: NodeJS.Timeout | null = null;

            const flushLogs = async () => {
                if (logBuffer.length === 0) return;
                const batch = [...logBuffer];
                logBuffer.length = 0; // Clear buffer

                await prisma.buildLog.createMany({
                    data: batch.map(message => ({
                        buildId,
                        message: message.replace(/\u0000/g, '').trim(),
                        level: 'INFO',
                    })),
                }).catch(err => logger.error(err, 'Failed to save build logs batch'));

                await publisher.publishBuildLogs(buildId, userId, repoId, batch);
            };

            const logListener = ({ buildId: logId, message }: { buildId: string, message: string }) => {
                if (logId === buildId) {
                    // Also log to worker console for visibility
                    const cleanLog = message.replace(/\u0000/g, '').trim();
                    if (cleanLog) {
                        logger.info(`[build-log] ${cleanLog}`);
                    }

                    logBuffer.push(message);
                    if (logBuffer.length >= BATCH_SIZE) {
                        flushLogs();
                    } else if (!batchTimeout) {
                        batchTimeout = setTimeout(() => {
                            batchTimeout = null;
                            flushLogs();
                        }, 2000);
                    }
                }
            };

            dockerService.on('log', logListener);

            // Trigger Build
            const startTime = Date.now();
            const apkUrl = await dockerService.buildShellAPK({
                repoId,
                repoUrl,
                branch,
                commit,
                buildId,
            });

            const buildDuration = Math.floor((Date.now() - startTime) / 1000);

            // Cleanup log listener and flush remaining
            dockerService.off('log', logListener);
            if (batchTimeout) clearTimeout(batchTimeout);
            await flushLogs();

            // Read metadata
            const metadataPath = path.join(process.cwd(), 'uploads/shells', repoId, commit, 'build-info.json');
            let metadata = { apkSize: 0 };
            if (await fs.pathExists(metadataPath)) {
                metadata = await fs.readJSON(metadataPath);
            }

            // Update Build Success
            await prisma.build.update({
                where: { id: buildId },
                data: {
                    status: 'SUCCESS',
                    completedAt: new Date(),
                    buildDuration,
                    apkUrl,
                    apkSize: metadata.apkSize,
                },
            });

            await publisher.publishBuildSuccess(buildId, userId, repoId, apkUrl);

            // Auto-deploy to any active emulator session for this repo (non-fatal)
            try {
                const packageName = await getPackageNameFromManifest(repoId);
                await emulatorService.deployToExistingSession(repoId, apkUrl, packageName);
            } catch (deployErr) {
                logger.warn(`[shell-builder] Emulator auto-deploy failed (non-fatal): ${deployErr}`);
            }

            // Auto-start session if requested
            if (autoStartSession) {
                const { triggerSessionStart } = await import('../queues/build.queue');
                await triggerSessionStart({
                    buildId,
                    repoId,
                    userId,
                    emulatorConfig,
                });
            }

            return { success: true, apkUrl };

        } catch (error: any) {
            logger.error(`[shell-builder] Build ${buildId} failed: ${error.message}`);

            await prisma.build.update({
                where: { id: buildId },
                data: {
                    status: 'FAILED',
                    completedAt: new Date(),
                    error: error.message,
                },
            });

            await publisher.publishBuildFailed(buildId, userId, repoId, error.message);
            throw error;
        }
    },
    {
        connection: {
            host: env.REDIS_HOST || 'localhost',
            port: Number(env.REDIS_PORT) || 6379,
        },
        concurrency: Number(env.BUILD_CONCURRENCY) || 2,
    }
);
