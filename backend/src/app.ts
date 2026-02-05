import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import { Server } from 'socket.io';
import { env } from './config/env';
import { logger } from './utils/logger';

export async function buildApp(): Promise<FastifyInstance> {
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
    });

    await app.register(websocket);

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

    io.on('connection', (socket) => {
        app.log.info(`Client connected: ${socket.id}`);

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

    // Attach io to app for use in routes
    app.decorate('io', io);

    // Register routes
    const { repoRoutes } = await import('./routes/repos');
    const { buildRoutes } = await import('./routes/builds');
    const { sessionRoutes } = await import('./routes/sessions');
    const { webhookRoutes } = await import('./routes/webhooks');

    await app.register(repoRoutes, { prefix: '/api/repos' });
    await app.register(buildRoutes, { prefix: '/api/builds' });
    await app.register(sessionRoutes, { prefix: '/api/sessions' });
    await app.register(webhookRoutes, { prefix: '/api/webhooks' });

    return app;
}

// Extend Fastify instance type to include io
declare module 'fastify' {
    interface FastifyInstance {
        io: Server;
    }
}
