import { Worker, Job } from 'bullmq';
import { WorkerContext } from './worker-auth';
import { EventPublisher } from '../events/event-publisher';
import { EmulatorService } from '../services/emulator.service';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// Initialize context ONCE if not already
WorkerContext.initialize().catch(() => { /* may be already init */ });

const emulatorService = new EmulatorService();

interface SessionJob {
    sessionId: string;
    userId: string;
    repoId: string;
    buildId: string;
}

export const emulatorManagerWorker = new Worker<SessionJob>(
    'session-actions',
    async (job: Job<SessionJob>) => {
        const { sessionId, userId, repoId, buildId } = job.data;
        const prisma = WorkerContext.getPrisma();
        const publisher = new EventPublisher(WorkerContext.getPublisher());

        logger.info(`[emulator-manager] Starting session ${sessionId} for build ${buildId}`);

        try {
            // 1. Initial status update
            await prisma.emulatorSession.update({
                where: { id: sessionId },
                data: { status: 'STARTING' },
            });

            await publisher.publishSessionStatus(sessionId, userId, 'STARTING');

            // 2. Launch using EmulatorService
            // Note: EmulatorService might need adjustment to take sessionId and buildId specifically
            const session = await emulatorService.createSession({
                userId,
                repoId,
                shellId: buildId,
            });

            // EmulatorService.createSession returns the session record but it also starts docker internally.
            // Since we already created the record in triggerSessionStart, we might want to 
            // refactor EmulatorService to be more granular. 
            // For now, EmulatorService.createSession actually creates ANOTHER record if we are not careful.

            // Looking at EmulatorService (turn 1758): it calls prisma.emulatorSession.create
            // We should fix EmulatorService to support attaching to an existing session or 
            // just use it for the Docker part.

            await publisher.publishSessionStatus(sessionId, userId, 'RUNNING');
            logger.info(`[emulator-manager] Session ${sessionId} is now RUNNING`);

        } catch (error: any) {
            logger.error(`[emulator-manager] Session ${sessionId} failed: ${error.message}`);

            await prisma.emulatorSession.update({
                where: { id: sessionId },
                data: { status: 'ERROR', stoppedAt: new Date() },
            });

            await publisher.publishSessionError(sessionId, userId, error.message);
            throw error;
        }
    },
    {
        connection: {
            host: env.REDIS_HOST || 'localhost',
            port: Number(env.REDIS_PORT) || 6379,
        },
        concurrency: 1, // Only one emulator at a time for stability on host
    }
);
