import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { env } from '../config/env';

export class WorkerContext {
    private static prisma: PrismaClient;
    private static redis: Redis;

    static async initialize() {
        if (!this.prisma) {
            this.prisma = new PrismaClient({
                datasources: {
                    db: {
                        url: env.DATABASE_URL
                    }
                }
            });
        }

        if (!this.redis) {
            this.redis = new Redis({
                host: env.REDIS_HOST,
                port: Number(env.REDIS_PORT),
            });
        }

        // Test connections
        try {
            await this.prisma.$connect();
            await this.redis.ping();
            console.log('✅ Worker context initialized');
        } catch (error) {
            console.error('❌ Failed to initialize worker context:', error);
            throw error;
        }
    }

    static getPrisma() {
        if (!this.prisma) {
            throw new Error('Worker context not initialized. Call initialize() first.');
        }
        return this.prisma;
    }

    static getRedis() {
        if (!this.redis) {
            throw new Error('Worker context not initialized. Call initialize() first.');
        }
        return this.redis;
    }

    static async shutdown() {
        if (this.prisma) await this.prisma.$disconnect();
        if (this.redis) await this.redis.quit();
    }
}
