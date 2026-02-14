import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { env } from '../config/env';

export class WorkerContext {
    private static prisma: PrismaClient | null = null;
    private static redis: Redis | null = null;
    private static publisher: Redis | null = null;
    private static initialized = false;
    private static healthCheckInterval: NodeJS.Timeout | null = null;

    static async initialize() {
        if (this.initialized) {
            console.log('⚠️  Worker context already initialized');
            return;
        }

        try {
            // Prisma initialization
            this.prisma = new PrismaClient({
                datasources: {
                    db: {
                        url: env.DATABASE_URL
                    }
                },
                log: [
                    { level: 'error', emit: 'stdout' },
                    { level: 'warn', emit: 'stdout' }
                ]
            });

            await this.prisma.$connect();
            console.log('✅ Worker Prisma connected');

            // Redis for general operations (queues, etc.)
            this.redis = new Redis({
                host: env.REDIS_HOST,
                port: Number(env.REDIS_PORT),
                maxRetriesPerRequest: 3,
                retryStrategy(times) {
                    return Math.min(times * 50, 2000);
                }
            });

            await this.redis.ping();
            console.log('✅ Worker Redis connected');

            // Separate Redis connection for publishing (Pub/Sub requires dedicated connections)
            this.publisher = new Redis({
                host: env.REDIS_HOST,
                port: Number(env.REDIS_PORT),
            });

            await this.publisher.ping();
            console.log('✅ Worker Redis publisher connected');

            this.initialized = true;
            this.startHealthCheck();

        } catch (error) {
            console.error('❌ Failed to initialize worker context:', error);
            await this.shutdown();
            throw error;
        }
    }

    private static startHealthCheck() {
        if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);

        this.healthCheckInterval = setInterval(async () => {
            try {
                // Check Prisma
                if (this.prisma) await this.prisma.$queryRaw`SELECT 1`;

                // Check Redis
                if (this.redis) await this.redis.ping();
                if (this.publisher) await this.publisher.ping();
            } catch (error) {
                console.error('⚠️  Worker health check failed:', error);
                // In production, you might want more complex reconnection logic here
            }
        }, 30000); // Every 30 seconds
    }

    static getPrisma(): PrismaClient {
        if (!this.prisma) {
            throw new Error('Worker context not initialized. Call initialize() first.');
        }
        return this.prisma;
    }

    static getRedis(): Redis {
        if (!this.redis) {
            throw new Error('Worker context not initialized. Call initialize() first.');
        }
        return this.redis;
    }

    static getPublisher(): Redis {
        if (!this.publisher) {
            throw new Error('Worker context not initialized. Call initialize() first.');
        }
        return this.publisher;
    }

    static async shutdown() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }

        if (this.prisma) await this.prisma.$disconnect();
        if (this.redis) await this.redis.quit();
        if (this.publisher) await this.publisher.quit();

        this.prisma = null;
        this.redis = null;
        this.publisher = null;
        this.initialized = false;

        console.log('✅ Worker context shutdown complete');
    }
}
