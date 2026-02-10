import { prisma } from '../db/prisma';
import { DockerService } from './docker.service';
import { logger } from '../utils/logger';

/** Idle timeout in milliseconds (30 minutes) */
const METRO_IDLE_TIMEOUT = 30 * 60 * 1000;

/** Health check interval in milliseconds (60 seconds) */
const HEALTH_CHECK_INTERVAL = 60 * 1000;

export class MetroService {
    private docker: DockerService;
    private healthCheckers: Map<string, NodeJS.Timeout> = new Map();

    constructor() {
        this.docker = new DockerService();
    }

    /**
     * Start Metro bundler for a repository with health checking.
     */
    async startMetro(repoId: string, repoPath: string) {
        logger.info(`Starting Metro bundler for repo ${repoId}`);

        // Check if Metro is already running
        const existing = await prisma.metroInstance.findUnique({
            where: { repoId },
        });

        if (existing) {
            const isRunning = await this.docker.isContainerRunning(existing.containerId);
            if (isRunning) {
                logger.info(`Metro already running for repo ${repoId}`);
                // Touch activity timestamp
                await prisma.metroInstance.update({
                    where: { id: existing.id },
                    data: { lastActivity: new Date() },
                });
                return existing;
            } else {
                // Clean up stale record
                logger.warn(`Stale Metro record found for repo ${repoId}, cleaning up`);
                this.stopHealthChecker(existing.id);
                await prisma.metroInstance.delete({ where: { id: existing.id } });
            }
        }

        // Start new Metro container
        const { containerId, httpPort, wsPort } = await this.docker.startMetro({
            repoId,
            repoPath,
        });

        // Save to database
        const instance = await prisma.metroInstance.create({
            data: {
                repoId,
                containerId,
                containerName: `metro-${repoId}`,
                httpPort,
                wsPort,
                status: 'STARTING',
            },
        });

        // Start health checking loop
        this.startHealthChecker(instance.id, containerId);

        // Initial readiness check after 5 seconds
        setTimeout(async () => {
            await this.checkHealth(instance.id);
        }, 5000);

        return instance;
    }

    /**
     * Stop Metro bundler and clean up.
     */
    async stopMetro(repoId: string) {
        const instance = await prisma.metroInstance.findUnique({
            where: { repoId },
        });

        if (!instance) {
            return;
        }

        logger.info(`Stopping Metro bundler for repo ${repoId}`);

        // Stop health checker
        this.stopHealthChecker(instance.id);

        // Stop Docker container
        try {
            await this.docker.stopContainer(instance.containerId);
        } catch (error) {
            logger.warn(`Failed to stop Metro container ${instance.containerId}, it may already be stopped`);
        }

        await prisma.metroInstance.delete({
            where: { id: instance.id },
        });
    }

    /**
     * Restart Metro bundler for a repository (e.g., after metro.config.js changes).
     */
    async restartMetro(repoId: string, repoPath: string) {
        logger.info(`Restarting Metro bundler for repo ${repoId}`);
        await this.stopMetro(repoId);
        return this.startMetro(repoId, repoPath);
    }

    /**
     * Check Metro health and update status.
     */
    async checkHealth(instanceId: string) {
        const instance = await prisma.metroInstance.findUnique({
            where: { id: instanceId },
        });

        if (!instance) {
            return;
        }

        try {
            const isRunning = await this.docker.isContainerRunning(instance.containerId);

            if (isRunning) {
                await prisma.metroInstance.update({
                    where: { id: instanceId },
                    data: {
                        status: 'READY',
                        lastHealthCheck: new Date(),
                    },
                });
            } else {
                logger.warn(`Metro container ${instance.containerId} is not running`);
                await prisma.metroInstance.update({
                    where: { id: instanceId },
                    data: { status: 'ERROR' },
                });
            }
        } catch (error) {
            logger.error(`Metro health check failed for ${instanceId}: ${String(error)}`);
            await prisma.metroInstance.update({
                where: { id: instanceId },
                data: { status: 'ERROR' },
            });
        }
    }

    /**
     * Trigger hot reload (force Metro to regenerate bundle).
     */
    async triggerHotReload(repoId: string) {
        const instance = await prisma.metroInstance.findUnique({
            where: { repoId },
        });

        if (!instance) {
            throw new Error(`Metro instance not found for repo ${repoId}`);
        }

        logger.info(`Triggering hot reload for repo ${repoId}`);

        await prisma.metroInstance.update({
            where: { id: instance.id },
            data: {
                lastBundleAt: new Date(),
                lastActivity: new Date(),
                bundleCount: { increment: 1 },
            },
        });

        return instance;
    }

    /**
     * Get Metro URL for a repository.
     */
    async getMetroUrl(repoId: string): Promise<string | null> {
        const instance = await prisma.metroInstance.findUnique({
            where: { repoId },
        });

        if (!instance || instance.status !== 'READY') {
            return null;
        }

        return `http://localhost:${instance.httpPort}`;
    }

    /**
     * Cleanup idle Metro instances (TTL-based, 30 minutes).
     */
    async cleanupIdle() {
        const idleThreshold = new Date(Date.now() - METRO_IDLE_TIMEOUT);

        const idleInstances = await prisma.metroInstance.findMany({
            where: {
                lastActivity: {
                    lt: idleThreshold,
                },
                status: {
                    in: ['READY', 'STARTING'],
                },
            },
        });

        logger.info(`Found ${idleInstances.length} idle Metro instances (threshold: 30m)`);

        for (const instance of idleInstances) {
            try {
                await this.stopMetro(instance.repoId);
                logger.info(`Stopped idle Metro instance for repo ${instance.repoId}`);
            } catch (error) {
                logger.error(`Failed to stop Metro instance ${instance.id}: ${String(error)}`);
            }
        }
    }

    // ==================== PRIVATE HELPERS ====================

    /**
     * Start periodic health checker for a Metro instance.
     */
    private startHealthChecker(instanceId: string, containerId: string) {
        const interval = setInterval(async () => {
            try {
                const isRunning = await this.docker.isContainerRunning(containerId);
                if (!isRunning) {
                    logger.warn(`Metro container ${containerId} crashed. Updating status.`);
                    await prisma.metroInstance.update({
                        where: { id: instanceId },
                        data: { status: 'ERROR' },
                    }).catch(() => { /* instance may be deleted */ });
                }
            } catch (error) {
                // Ignore errors during health check
            }
        }, HEALTH_CHECK_INTERVAL);

        this.healthCheckers.set(instanceId, interval);
    }

    /**
     * Stop health checker for a Metro instance.
     */
    private stopHealthChecker(instanceId: string) {
        const interval = this.healthCheckers.get(instanceId);
        if (interval) {
            clearInterval(interval);
            this.healthCheckers.delete(instanceId);
        }
    }
}
