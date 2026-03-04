import { FastifyInstance } from 'fastify';
import { prisma } from '../db/prisma';
import { emulatorService } from '../services/emulator.service';
import { adbService } from '../services/adb.service';
import { authenticateUser } from '../middleware/auth.middleware';
import { startSessionSchema, sessionParamsSchema } from '../schemas/session.schema';
import { handlePrismaError } from '../utils/error-handler';
import { logger } from '../utils/logger';
import { env } from '../config/env';

/** Key events that are explicitly allowed from the browser. */
const ALLOWED_KEYCODES = new Set([
    'KEYCODE_BACK',
    'KEYCODE_HOME',
    'KEYCODE_APP_SWITCH',
    'KEYCODE_R',
    'KEYCODE_MENU',
    'KEYCODE_VOLUME_UP',
    'KEYCODE_VOLUME_DOWN',
]);

export async function sessionRoutes(app: FastifyInstance) {
    // Authenticate all routes in this plugin
    app.addHook('onRequest', authenticateUser);

    // -------------------------------------------------------------------------
    // GET /sessions — List active sessions
    // -------------------------------------------------------------------------
    app.get('/', async (request, reply) => {
        const userId = request.user!.id;

        try {
            const sessions = await prisma.emulatorSession.findMany({
                where: { userId, status: { in: ['STARTING', 'RUNNING'] } },
                include: { repo: true },
            });
            return { sessions };
        } catch (error: unknown) {
            const appError = handlePrismaError(error);
            return reply.code(appError.statusCode).send({ error: appError.code, message: appError.message });
        }
    });

    // -------------------------------------------------------------------------
    // POST /sessions — Start emulator session
    // -------------------------------------------------------------------------
    app.post('/', {
        schema: startSessionSchema,
    }, async (request, reply) => {
        const { repoId, shellId, emulatorConfig } = request.body as {
            repoId: string;
            shellId?: string;
            emulatorConfig?: Record<string, unknown>;
        };
        const userId = request.user!.id;

        try {
            const session = await emulatorService.createSession({ userId, repoId, shellId, config: emulatorConfig });
            return { success: true, session };
        } catch (error: unknown) {
            const appError = handlePrismaError(error);
            return reply.code(appError.statusCode).send({ error: appError.code, message: appError.message });
        }
    });

    // -------------------------------------------------------------------------
    // GET /sessions/:id — Get session status
    // -------------------------------------------------------------------------
    app.get<{ Params: { id: string } }>('/:id', {
        schema: sessionParamsSchema,
    }, async (request, reply) => {
        const userId = request.user!.id;
        const { id } = request.params;

        try {
            const session = await prisma.emulatorSession.findFirst({
                where: { id, userId },
                include: { repo: true },
            });

            if (!session) return reply.code(404).send({ error: 'Session not found' });
            return { session };
        } catch (error: unknown) {
            const appError = handlePrismaError(error);
            return reply.code(appError.statusCode).send({ error: appError.code, message: appError.message });
        }
    });

    // -------------------------------------------------------------------------
    // DELETE /sessions/:id — Stop session
    // -------------------------------------------------------------------------
    app.delete<{ Params: { id: string } }>('/:id', {
        schema: sessionParamsSchema,
    }, async (request, reply) => {
        const userId = request.user!.id;
        const { id } = request.params;

        try {
            await emulatorService.stopSession(id, userId);
            return { success: true };
        } catch (error: unknown) {
            const appError = handlePrismaError(error);
            return reply.code(appError.statusCode).send({ error: appError.code, message: appError.message });
        }
    });

    // -------------------------------------------------------------------------
    // POST /sessions/:id/tap — Send a tap event (with coordinate scaling)
    // -------------------------------------------------------------------------
    app.post<{ Params: { id: string } }>('/:id/tap', async (request, reply) => {
        const userId = request.user!.id;
        const { id } = request.params;
        const { x, y, frontendWidth, frontendHeight } = request.body as {
            x: number;
            y: number;
            frontendWidth: number;
            frontendHeight: number;
        };

        try {
            await emulatorService.sendTap(id, userId, x, y, frontendWidth, frontendHeight);
            return { success: true };
        } catch (error: unknown) {
            if (error instanceof Error && error.message === 'Session not running') {
                return reply.code(400).send({ error: 'SESSION_NOT_RUNNING' });
            }
            const appError = handlePrismaError(error);
            return reply.code(appError.statusCode).send({ error: appError.code, message: appError.message });
        }
    });

    // -------------------------------------------------------------------------
    // POST /sessions/:id/swipe — Send a swipe gesture
    // -------------------------------------------------------------------------
    app.post<{ Params: { id: string } }>('/:id/swipe', async (request, reply) => {
        const userId = request.user!.id;
        const { id } = request.params;
        const { x1, y1, x2, y2, duration, frontendWidth, frontendHeight } = request.body as {
            x1: number;
            y1: number;
            x2: number;
            y2: number;
            duration: number;
            frontendWidth: number;
            frontendHeight: number;
        };

        try {
            await emulatorService.sendSwipe(
                id, userId,
                x1, y1, x2, y2,
                duration ?? 300,
                frontendWidth, frontendHeight,
            );
            return { success: true };
        } catch (error: unknown) {
            if (error instanceof Error && error.message === 'Session not running') {
                return reply.code(400).send({ error: 'SESSION_NOT_RUNNING' });
            }
            const appError = handlePrismaError(error);
            return reply.code(appError.statusCode).send({ error: appError.code, message: appError.message });
        }
    });

    // -------------------------------------------------------------------------
    // POST /sessions/:id/input — Legacy generic input handler
    // -------------------------------------------------------------------------
    app.post<{ Params: { id: string } }>('/:id/input', {
        schema: sessionParamsSchema,
    }, async (request, reply) => {
        const userId = request.user!.id;
        const { id } = request.params;
        const input = request.body as {
            type: 'tap' | 'swipe' | 'key' | 'text';
            x?: number;
            y?: number;
            x2?: number;
            y2?: number;
            key?: string;
            text?: string;
        };

        try {
            await emulatorService.sendInput(id, userId, input);
            return { success: true };
        } catch (error: unknown) {
            logger.error(`Error in POST /sessions/${id}/input: ${String(error)}`);
            const appError = handlePrismaError(error);
            return reply.code(appError.statusCode).send({ error: appError.code, message: appError.message });
        }
    });

    // -------------------------------------------------------------------------
    // POST /sessions/:id/input/key — Allowlisted key event
    // -------------------------------------------------------------------------
    app.post<{ Params: { id: string } }>('/:id/input/key', async (request, reply) => {
        const userId = request.user!.id;
        const { id } = request.params;
        const { keycode } = request.body as { keycode: string };

        if (!ALLOWED_KEYCODES.has(keycode)) {
            return reply.code(400).send({
                error: 'INVALID_KEYCODE',
                message: `Keycode "${keycode}" is not allowed. Permitted: ${[...ALLOWED_KEYCODES].join(', ')}`,
            });
        }

        try {
            const session = await prisma.emulatorSession.findFirst({ where: { id, userId } });
            if (!session) return reply.code(404).send({ error: 'Session not found' });

            const ip = await emulatorService.getContainerIp(session.containerId);
            const serial = `${ip}:${env.REDROID_ADB_PORT}`;
            await adbService.sendKey(serial, keycode);

            return { success: true };
        } catch (error: unknown) {
            const appError = handlePrismaError(error);
            return reply.code(appError.statusCode).send({ error: appError.code, message: appError.message });
        }
    });

    // -------------------------------------------------------------------------
    // GET /sessions/:id/screen — Static PNG screenshot
    // -------------------------------------------------------------------------
    app.get<{ Params: { id: string } }>('/:id/screen', {
        schema: sessionParamsSchema,
    }, async (request, reply) => {
        const userId = request.user!.id;
        const { id } = request.params;

        try {
            const buffer = await emulatorService.getScreenshot(id, userId);
            return reply.type('image/png').send(buffer);
        } catch (error: unknown) {
            const appError = handlePrismaError(error);
            return reply.code(appError.statusCode).send({ error: appError.code, message: appError.message });
        }
    });

    // -------------------------------------------------------------------------
    // GET /sessions/:id/stream — MJPEG stream endpoint
    // -------------------------------------------------------------------------
    app.get<{ Params: { id: string } }>('/:id/stream', async (request, reply) => {
        const userId = request.user!.id;
        const { id } = request.params;

        // Verify session exists and is RUNNING before opening stream
        const session = await prisma.emulatorSession.findFirst({ where: { id, userId } });

        if (!session) {
            return reply.code(404).send({ error: 'Session not found' });
        }

        if (session.status !== 'RUNNING') {
            return reply.code(503).send({
                error: 'Session not ready',
                status: session.status,
            });
        }

        // ── Set MJPEG stream headers ──────────────────────────────────────────
        reply.raw.writeHead(200, {
            'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
            'Cache-Control': 'no-cache, no-store',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',   // Critical: disables nginx buffering
            'Pragma': 'no-cache',
        });

        let closed = false;
        let heartbeatTimer: NodeJS.Timeout | null = null;

        // Send a single MJPEG frame (JPEG buffer)
        const writeFrame = (buffer: Buffer): boolean => {
            if (closed) return false;
            try {
                reply.raw.write(`--frame\r\n`);
                reply.raw.write(`Content-Type: image/jpeg\r\n`);
                reply.raw.write(`Content-Length: ${buffer.length}\r\n\r\n`);
                reply.raw.write(buffer);
                reply.raw.write(`\r\n`);
                return true;
            } catch {
                return false;
            }
        };

        // Heartbeat: send an empty boundary every 30s to keep the connection alive
        const scheduleHeartbeat = () => {
            heartbeatTimer = setTimeout(() => {
                if (!closed) {
                    try { reply.raw.write(`--frame\r\n\r\n`); } catch { /* ignore */ }
                    scheduleHeartbeat();
                }
            }, 30_000);
        };
        scheduleHeartbeat();

        // Screenshot-polling loop (fallback when scrcpy isn't piping frames)
        const FPS = env.REDROID_FPS;
        const frameInterval = Math.floor(1_000 / FPS);

        const streamInterval = setInterval(async () => {
            if (closed) {
                clearInterval(streamInterval);
                return;
            }

            try {
                const buffer = await emulatorService.getScreenshotJpeg(id, userId);
                writeFrame(buffer);
            } catch {
                // Session may have ended — stop polling
                clearInterval(streamInterval);
                if (!closed) {
                    closed = true;
                    reply.raw.end();
                }
            }
        }, frameInterval);

        // Cleanup on client disconnect — do NOT kill scrcpy; other clients may be watching
        request.raw.on('close', () => {
            closed = true;
            clearInterval(streamInterval);
            if (heartbeatTimer) clearTimeout(heartbeatTimer);
            logger.debug(`[sessions] MJPEG client disconnected from session ${id}`);
        });

        // Keep the Fastify reply open
        return reply;
    });
}
