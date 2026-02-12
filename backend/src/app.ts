import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { Server } from 'socket.io';
import Redis from 'ioredis';
import path from 'path';
import { env } from './config/env';
import { logger } from './utils/logger';

export async function buildApp(): Promise<any> {
    const app = Fastify({
        logger: logger,
        requestIdHeader: 'x-request-id',
        requestIdLogLabel: 'reqId',
    });

    // Register plugins
    await app.register(cors, {
        origin: env.FRONTEND_URL,
        credentials: true,
    });

    await app.register(jwt, {
        secret: env.JWT_SECRET,
        sign: {
            expiresIn: '7d',
        },
    });


    // Serve static files from uploads directory
    await app.register(require('@fastify/static'), {
        root: path.join(process.cwd(), 'uploads'),
        prefix: '/storage/', // accessible via /storage/filename.ext
    });

    // Health check
    app.get('/health', async () => {
        return {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
        };
    });

    // Socket.IO for real-time updates
    const io = new Server(app.server, {
        cors: {
            origin: env.FRONTEND_URL,
            credentials: true,
        },
    });

    // Socket.IO Authentication Middleware
    io.use(async (socket, next) => {
        const token = socket.handshake.auth.token || socket.handshake.query.token;
        if (!token) return next(new Error('Authentication failed: No token provided'));

        try {
            const decoded = app.jwt.verify(token) as { id: string };
            socket.data.userId = decoded.id;

            // Join user-specific room
            socket.join(`user:${decoded.id}`);
            next();
        } catch (error) {
            next(new Error('Authentication failed: Invalid token'));
        }
    });

    io.on('connection', (socket) => {
        const userId = socket.data.userId;
        app.log.info(`Client connected: ${socket.id} (User: ${userId})`);

        socket.on('subscribe:build', (buildId: string) => {
            socket.join(`build:${buildId}`);
            app.log.info(`Client ${socket.id} subscribed to build:${buildId}`);
        });

        socket.on('subscribe:session', (sessionId: string) => {
            socket.join(`session:${sessionId}`);
            app.log.info(`Client ${socket.id} subscribed to session:${sessionId}`);
        });

        socket.on('disconnect', () => {
            app.log.info(`Client disconnected: ${socket.id}`);
        });
    });

    // Redis subscriber for events
    const sub = new Redis({
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
    });

    sub.subscribe('build-events', 'session-events');
    sub.on('message', (channel, message) => {
        try {
            const event = JSON.parse(message);

            if (channel === 'build-events') {
                if (event.buildId) {
                    io.to(`build:${event.buildId}`).emit('build:update', event);
                }
                if (event.userId) {
                    io.to(`user:${event.userId}`).emit('build:event', event);
                }
            } else if (channel === 'session-events') {
                if (event.sessionId) {
                    io.to(`session:${event.sessionId}`).emit('session:event', event);
                }
                if (event.userId) {
                    io.to(`user:${event.userId}`).emit('session:event', event);
                }
            }
        } catch (error) {
            app.log.error(`Failed to parse event from channel ${channel}: ${String(error)}`);
        }
    });

    // Worker Health Checks
    const { shellBuildQueue } = await import('./queues/build.queue');
    setInterval(async () => {
        const workers = await shellBuildQueue.getWorkers();
        if (workers.length === 0) {
            app.log.error('⚠️ No build workers running!');
        }
    }, 60000);

    // Attach io to app for use in routes
    app.decorate('io', io);

    // Register routes
    const { authRoutes } = await import('./routes/auth');
    const { repoRoutes } = await import('./routes/repos');
    const { buildRoutes } = await import('./routes/builds');
    const { sessionRoutes } = await import('./routes/sessions');
    const { webhookRoutes } = await import('./routes/webhooks');
    const { webrtcRoutes } = await import('./routes/webrtc');
    const { adminRoutes } = await import('./routes/admin');

    await app.register(authRoutes, { prefix: '/api/auth' });
    await app.register(repoRoutes, { prefix: '/api/repos' });
    await app.register(buildRoutes, { prefix: '/api/builds' });
    await app.register(sessionRoutes, { prefix: '/api/sessions' });
    await app.register(webhookRoutes, { prefix: '/api/webhooks' });
    await app.register(webrtcRoutes, { prefix: '/api/webrtc' });
    await app.register(adminRoutes, { prefix: '/api/admin' });

    // Graceful Shutdown handled in index.ts for better control

    return app;
}

// Extend Fastify instance type to include io
declare module 'fastify' {
    interface FastifyInstance {
        io: Server;
    }
}
