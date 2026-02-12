import { buildApp } from './app';
import { env } from './config/env';
import { prisma } from './db/prisma';
import { redis } from './config/redis';
import { WorkerContext } from './workers/worker-auth';

async function start() {
    // Start Worker Context & Workers
    await WorkerContext.initialize();
    const workers = await import('./workers');

    try {
        const app = await buildApp();

        // Test database connection
        await prisma.$connect();
        app.log.info('✅ Database connected');

        // Test Redis connection
        await redis.ping();
        app.log.info('✅ Redis connected');

        // Start server
        await app.listen({
            port: env.API_PORT,
            host: '0.0.0.0',
        });

        app.log.info(`🚀 ReactFlow API server running on http://localhost:${env.API_PORT}`);

        // Graceful Shutdown
        const shutdown = async (signal: string) => {
            app.log.info(`Received ${signal}, starting graceful shutdown...`);

            // 1. Close Fastify
            await app.close();

            // 2. Close Workers
            // Note: workers/index.ts should handle its own worker.close() calls

            // 3. Close DB & Redis
            await prisma.$disconnect();
            await redis.quit();

            app.log.info('Graceful shutdown complete.');
            process.exit(0);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

start();
