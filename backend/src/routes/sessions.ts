import { FastifyInstance } from 'fastify';
import { prisma } from '../db/prisma';
import { emulatorService } from '../services/emulator.service';
import { authenticateUser } from '../middleware/auth.middleware';
import { startSessionSchema, sessionParamsSchema } from '../schemas/session.schema';
import { handlePrismaError } from '../utils/error-handler';

export async function sessionRoutes(app: FastifyInstance) {
    // Authenticate all routes in this plugin
    app.addHook('onRequest', authenticateUser);

    // List active sessions
    app.get('/', async (request, reply) => {
        const userId = request.user!.id;

        try {
            const sessions = await prisma.emulatorSession.findMany({
                where: { userId, status: 'RUNNING' },
                include: { repo: true },
            });
            return { sessions };
        } catch (error: any) {
            const appError = handlePrismaError(error);
            return reply.code(appError.statusCode).send({
                error: appError.code,
                message: appError.message
            });
        }
    });

    // Start emulator session
    app.post('/', {
        schema: startSessionSchema
    }, async (request, reply) => {
        const { repoId, shellId, emulatorConfig } = request.body as any;
        const userId = request.user!.id;

        try {
            const session = await emulatorService.createSession({
                userId,
                repoId,
                shellId,
                config: emulatorConfig
            });

            return { success: true, session };
        } catch (error: any) {
            const appError = handlePrismaError(error);
            return reply.code(appError.statusCode).send({
                error: appError.code,
                message: appError.message
            });
        }
    });

    // Get session status
    app.get<{
        Params: { id: string };
    }>('/:id', {
        schema: sessionParamsSchema
    }, async (request, reply) => {
        const userId = request.user!.id;
        const { id } = request.params;

        try {
            const session = await prisma.emulatorSession.findFirst({
                where: { id, userId },
                include: { repo: true },
            });

            if (!session) {
                return reply.code(404).send({ error: 'Session not found' });
            }

            return { session };
        } catch (error: any) {
            const appError = handlePrismaError(error);
            return reply.code(appError.statusCode).send({
                error: appError.code,
                message: appError.message
            });
        }
    });

    // Stop session
    app.delete<{
        Params: { id: string };
    }>('/:id', {
        schema: sessionParamsSchema
    }, async (request, reply) => {
        const userId = request.user!.id;
        const { id } = request.params;

        try {
            await emulatorService.stopSession(id, userId);
            return { success: true };
        } catch (error: any) {
            const appError = handlePrismaError(error);
            return reply.code(appError.statusCode).send({
                error: appError.code,
                message: appError.message
            });
        }
    });

    // Send input to emulator
    app.post<{
        Params: { id: string };
    }>('/:id/input', {
        schema: sessionParamsSchema
    }, async (request, reply) => {
        const userId = request.user!.id;
        const { id } = request.params;
        const input = request.body;

        try {
            await emulatorService.sendInput(id, userId, input);
            return { success: true };
        } catch (error: any) {
            console.error('Error in POST /input:', error); // Added logging
            const appError = handlePrismaError(error);
            return reply.code(appError.statusCode).send({
                error: appError.code,
                message: appError.message
            });
        }
    });

    // Get screen capture (PNG)
    app.get<{
        Params: { id: string };
    }>('/:id/screen', {
        schema: sessionParamsSchema
    }, async (request, reply) => {
        const userId = request.user!.id;
        const { id } = request.params;

        try {
            const buffer = await emulatorService.getScreenshot(id, userId);
            return reply.type('image/png').send(buffer);
        } catch (error: any) {
            const appError = handlePrismaError(error);
            return reply.code(appError.statusCode).send({
                error: appError.code,
                message: appError.message
            });
        }
    });

    // Get MJPEG stream
    app.get<{
        Params: { id: string };
    }>('/:id/stream', {
        schema: sessionParamsSchema
    }, async (request, reply) => {
        const userId = request.user!.id;
        const { id } = request.params;

        // Set headers for multipart stream
        reply.raw.writeHead(200, {
            'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no' // Disable Nginx buffering if present
        });

        const callback = async () => {
            try {
                // Get JPEG frame (compressed)
                const buffer = await emulatorService.getScreenshotJpeg(id, userId);

                // Write multipart frame
                reply.raw.write(`--frame\r\n`);
                reply.raw.write(`Content-Type: image/jpeg\r\n`);
                reply.raw.write(`Content-Length: ${buffer.length}\r\n\r\n`);
                reply.raw.write(buffer);
                reply.raw.write(`\r\n`);
            } catch (error) {
                // Stop on error (session likely stopped)
                clearInterval(interval);
                reply.raw.end();
            }
        };

        // Initial frame
        await callback();

        const interval = setInterval(callback, 100); // 10 FPS

        // Cleanup on client disconnect
        request.raw.on('close', () => {
            clearInterval(interval);
        });

        // Keep connection open
        return reply;
    });
}
