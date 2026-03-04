import { Worker, Job } from 'bullmq';
import { WorkerContext } from './worker-auth';
import { EventPublisher } from '../events/event-publisher';
import { emulatorService } from '../services/emulator.service';
import { SessionLifecycleStep } from '../events/event-types';
import { redis } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// Initialize context ONCE if not already
WorkerContext.initialize().catch(() => { /* may already be init */ });

interface SessionJob {
    sessionId: string;
    userId: string;
    repoId: string;
    buildId: string;
    /** Optional: pre-resolved APK URL to skip DB lookup */
    apkUrl?: string;
    /** Optional: Android package name; defaults to 'com.anonymous' */
    packageName?: string;
}

export const emulatorManagerWorker = new Worker<SessionJob>(
    'session-actions',
    async (job: Job<SessionJob>) => {
        const { sessionId, userId, repoId, buildId, packageName } = job.data;
        const prisma = WorkerContext.getPrisma();
        const publisher = new EventPublisher(WorkerContext.getPublisher());

        logger.info(`[emulator-manager] Starting session job for ${sessionId}, build ${buildId}`);

        // -----------------------------------------------------------------------
        // Helper: emit lifecycle via Redis pub/sub (matching emulatorService)
        // -----------------------------------------------------------------------
        const emitStep = async (step: SessionLifecycleStep, message?: string) => {
            await redis.publish('session-lifecycle', JSON.stringify({
                sessionId,
                step,
                message,
                timestamp: Date.now(),
            }));
        };

        try {
            // --- PENDING ---
            await prisma.emulatorSession.update({
                where: { id: sessionId },
                data: { status: 'STARTING' },
            });
            await publisher.publishSessionStatus(sessionId, userId, 'STARTING');
            await emitStep(SessionLifecycleStep.PENDING, 'Preparing emulator session...');

            // --- Resolve APK ---
            let apkUrl = job.data.apkUrl;

            if (!apkUrl) {
                // Find the latest successful build for this repo
                const latestBuild = await prisma.build.findFirst({
                    where: { repoId, status: 'SUCCESS' },
                    orderBy: { completedAt: 'desc' },
                });

                if (!latestBuild?.apkUrl) {
                    // No build exists yet — set session to waiting state
                    await prisma.emulatorSession.update({
                        where: { id: sessionId },
                        data: { status: 'STARTING' },
                    });
                    await emitStep(
                        SessionLifecycleStep.WAITING_FOR_BUILD,
                        'No successful build found. Trigger a build and the emulator will start automatically.',
                    );
                    logger.info(`[emulator-manager] Session ${sessionId} is waiting for first build`);
                    // Return without throwing — the shell-builder will call deployToExistingSession when done
                    return { success: true, state: 'waiting-for-build' };
                }

                apkUrl = latestBuild.apkUrl;
            }

            // --- Resolve package name ---
            const resolvedPackageName = packageName ?? 'com.anonymous';

            // --- BOOTING ---
            await emitStep(SessionLifecycleStep.BOOTING, 'Starting Android container...');

            // Create / init the emulator session using EmulatorService
            // This will start the container and kick off fullBootAndDeployFlow in the background.
            // We update the existing DB record by passing sessionId so createSession upserts it.
            await emulatorService.createSession({
                userId,
                repoId,
                shellId: buildId,
                sessionId,
            });

            // fullBootAndDeployFlow runs in the background and emits its own lifecycle events.
            // The worker is done scheduling the work — the service handles the rest.
            logger.info(`[emulator-manager] Session ${sessionId} boot initiated.`);

            await publisher.publishSessionStatus(sessionId, userId, 'RUNNING');

            return { success: true, state: 'boot-initiated' };

        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`[emulator-manager] Session ${sessionId} failed: ${message}`);

            await prisma.emulatorSession.update({
                where: { id: sessionId },
                data: { status: 'ERROR', stoppedAt: new Date() },
            }).catch(() => { /* best effort */ });

            await publisher.publishSessionError(sessionId, userId, message);
            throw error;
        }
    },
    {
        connection: {
            host: env.REDIS_HOST || 'localhost',
            port: Number(env.REDIS_PORT) || 6379,
        },
        concurrency: 1, // Only one emulator at a time for host stability
    },
);
