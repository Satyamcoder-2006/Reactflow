import { config } from 'dotenv';

config();

export const env = {
    // Database
    DATABASE_URL: process.env.DATABASE_URL!,

    // Redis
    REDIS_HOST: process.env.REDIS_HOST || 'localhost',
    REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379'),

    // JWT
    JWT_SECRET: process.env.JWT_SECRET!,

    // GitHub
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID!,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET!,
    GITHUB_REDIRECT_URI: process.env.GITHUB_REDIRECT_URI!,

    // Build
    BUILD_CONCURRENCY: parseInt(process.env.BUILD_CONCURRENCY || '5'),
    GRADLE_CACHE_PATH: process.env.GRADLE_CACHE_PATH || '/var/cache/gradle',
    NPM_CACHE_PATH: process.env.NPM_CACHE_PATH || '/var/cache/npm',

    // API
    API_PORT: parseInt(process.env.API_PORT || '3001'),
    BACKEND_URL: process.env.BACKEND_URL || 'http://localhost:3001',
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',

    // Logging
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};

// Validate required environment variables
const requiredEnvVars = [
    'DATABASE_URL',
    'JWT_SECRET',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
];

for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
    }
}
