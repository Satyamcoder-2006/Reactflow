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
                timestamp: new Date().toISOString()
            }));

            // Listen to Docker logs
            const logListener = ({ buildId: logBuildId, message }: { buildId: string, message: string }) => {
                if (logBuildId === buildId) {
                    // Save log to database (batching recommended in prod, direct for MVP)
                    prisma.buildLog.create({
                        data: {
                            buildId,
                            message: message.trim(),
                            level: 'INFO'
                        },
                    }).catch(err => logger.error('Failed to save build log', err));

                    // Emit to frontend
                    redis.publish('build-events', JSON.stringify({
                        type: 'build:log',
                        buildId,
                        message: message.trim()
                    }));
                }
            };

            dockerService.on('log', logListener);

            // Start build
            const startTime = Date.now();

            const apkUrl = await dockerService.buildShellAPK({
                repoUrl,
                branch,
                commit,
                buildId,
            });

            const buildTime = Math.floor((Date.now() - startTime) / 1000);

            // Get APK size
            const apkSize = await storageService.getFileSize(apkUrl);

            // Save shell
            const shell = await shellService.saveShell(
                repoId,
                dependencyHash,
                apkUrl,
                {
                    apkSize,
                    buildTime,
                    reactNativeVersion: packageJson.dependencies['react-native'],
                    expoVersion: packageJson.dependencies['expo'],
                    dependencies: packageJson.dependencies,
                    // Extract gradle/android versions if available
                    gradleVersion: '8.6', // Default for now, ideally parsed from logs
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
        concurrency: Number(env.BUILD_CONCURRENCY) || 5, // Limit concurrent builds
    }
);

shellBuilderWorker.on('completed', (job) => {
    logger.info(`Build job ${job.id} completed`);
});

shellBuilderWorker.on('failed', (job, err) => {
    logger.error(`Build job ${job?.id} failed:`, err);
});
