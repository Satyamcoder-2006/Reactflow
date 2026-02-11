import { buildApp } from './app';
import { env } from './config/env';
import { prisma } from './db/prisma';
import { redis } from './config/redis';

async function start() {
    // Start workers
    await import('./workers');

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
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

start();
