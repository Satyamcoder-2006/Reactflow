import { Worker, Job } from 'bullmq';
import { prisma } from '../db/prisma';
import { DockerService } from '../services/docker.service';
import { ShellService } from '../services/shell.service';
import { StorageService } from '../services/storage.service';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { redis } from '../config/redis';

const dockerService = new DockerService();
const storageService = new StorageService();
const shellService = new ShellService(storageService);

interface ShellBuildJob {
    buildId: string;
    repoId: string;
    userId: string;
    repoUrl: string;
    branch: string;
    commit: string;
    packageJson: any;
    dependencyHash: string;
}

/** Maximum number of consecutive failures before we stop retrying */
const MAX_CONSECUTIVE_FAILURES = 3;

export const shellBuilderWorker = new Worker<ShellBuildJob>(
    'shell-build',
    async (job: Job<ShellBuildJob>) => {
        const { buildId, repoId, repoUrl, branch, commit, packageJson, dependencyHash } = job.data;

        logger.info(`Starting shell build job for build ${buildId}`);

        try {
            // Update build status
            await prisma.build.update({
                where: { id: buildId },
                data: { status: 'BUILDING', startedAt: new Date() },
            });

            // Emit start event via Redis pub/sub (which Socket.IO server listens to)
            await redis.publish('build-events', JSON.stringify({
                type: 'build:started',
                buildId,
                repoId,
                timestamp: new Date().toISOString()
            }));

            // Listen to Docker logs for real-time streaming
            const logBuffer: string[] = [];
            const BATCH_SIZE = 10;
            let batchTimeout: NodeJS.Timeout | null = null;

            const flushLogs = async () => {
                if (logBuffer.length === 0) return;
                const batch = logBuffer.splice(0, logBuffer.length);
                // Batch insert logs for better DB performance
                await prisma.buildLog.createMany({
                    data: batch.map(message => ({
                        buildId,
                        message: message.trim(),
                        level: 'INFO',
                    })),
                }).catch(err => logger.error('Failed to save build logs batch', err));

                // Emit last line to frontend
                await redis.publish('build-events', JSON.stringify({
                    type: 'build:log',
                    buildId,
                    message: batch[batch.length - 1]?.trim(),
                }));
            };

            const logListener = ({ buildId: logBuildId, message }: { buildId: string, message: string }) => {
                if (logBuildId === buildId) {
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

            // Start build with persistent cache volumes
            const startTime = Date.now();

            const apkUrl = await dockerService.buildShellAPK({
                repoUrl,
                branch,
                commit,
                buildId,
            });

            const buildTime = Math.floor((Date.now() - startTime) / 1000);

            // Flush remaining logs
            if (batchTimeout) clearTimeout(batchTimeout);
            await flushLogs();

            // Get APK size
            const apkSize = await storageService.getFileSize(apkUrl);

            // Save shell with versioned S3 URL
            const shell = await shellService.saveShell(
                repoId,
                dependencyHash,
                apkUrl,
                {
                    apkSize,
                    buildTime,
                    reactNativeVersion: packageJson?.dependencies?.['react-native'] || 'unknown',
                    expoVersion: packageJson?.dependencies?.['expo'],
                    dependencies: packageJson?.dependencies || {},
                    gradleVersion: '8.6',
                    androidSdkVersion: 34
                }
            );

            // Update build
            await prisma.build.update({
                where: { id: buildId },
                data: {
                    status: 'SUCCESS',
                    completedAt: new Date(),
                    buildDuration: buildTime,
                    shellId: shell.id,
                    apkUrl,
                    apkSize,
                },
            });

            // Emit success
            await redis.publish('build-events', JSON.stringify({
                type: 'build:complete',
                buildId,
                repoId,
                shellId: shell.id,
                apkUrl,
            }));

            dockerService.off('log', logListener);

            return { success: true, shellId: shell.id };
        } catch (error: any) {
            logger.error(`Build ${buildId} failed:`, error);

            // Update build with error
            await prisma.build.update({
                where: { id: buildId },
                data: {
                    status: 'FAILED',
                    completedAt: new Date(),
                    error: error.message,
                    errorStack: error.stack,
                },
            });

            // Emit error
            await redis.publish('build-events', JSON.stringify({
                type: 'build:failed',
                buildId,
                repoId,
                error: error.message,
            }));

            throw error;
        }
    },
    {
        connection: {
            host: env.REDIS_HOST || 'localhost',
            port: Number(env.REDIS_PORT) || 6379,
        },
        concurrency: Number(env.BUILD_CONCURRENCY) || 2, // Limit concurrent builds (2 for standard pool)
    }
);

shellBuilderWorker.on('completed', (job) => {
    logger.info(`Build job ${job.id} completed`);
});

shellBuilderWorker.on('failed', (job, err) => {
    logger.error(`Build job ${job?.id} failed: ${String(err)}`);
});
