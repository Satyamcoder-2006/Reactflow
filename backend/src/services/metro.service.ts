import { prisma } from '../db/prisma';
import { DockerService } from './docker.service';
import { logger } from '../utils/logger';

export class MetroService {
    private docker: DockerService;

    constructor() {
        this.docker = new DockerService();
    }

    /**
     * Start Metro bundler for a repository
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
                return existing;
            } else {
                // Clean up stale record
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

        // Wait for Metro to be ready (health check)
        setTimeout(async () => {
            await this.checkHealth(instance.id);
        }, 5000);

        return instance;
    }

    /**
     * Stop Metro bundler
     */
    async stopMetro(repoId: string) {
        const instance = await prisma.metroInstance.findUnique({
            where: { repoId },
        });

        if (!instance) {
            return;
        }

        logger.info(`Stopping Metro bundler for repo ${repoId}`);

        await this.docker.stopContainer(instance.containerId);

        await prisma.metroInstance.delete({
            where: { id: instance.id },
        });
    }

    /**
     * Check Metro health and update status
     */
    async checkHealth(instanceId: string) {
        const instance = await prisma.metroInstance.findUnique({
            where: { id: instanceId },
        });

        if (!instance) {
            return;
        }

        try {
            // Simple health check - try to exec a command
            const isRunning = await this.docker.isContainerRunning(instance.containerId);

            if (isRunning) {
                await prisma.metroInstance.update({
                    where: { id: instanceId },
                    data: {
                        status: 'READY',
                        lastHealthCheck: new Date(),
                        lastActivity: new Date(),
                    },
                });
            } else {
                await prisma.metroInstance.update({
                    where: { id: instanceId },
                    data: { status: 'ERROR' },
                });
            }
        } catch (error) {
            logger.error(`Metro health check failed for ${instanceId}:`, error);
            await prisma.metroInstance.update({
                where: { id: instanceId },
                data: { status: 'ERROR' },
            });
        }
    }

    /**
     * Trigger hot reload (force Metro to regenerate bundle)
     */
    async triggerHotReload(repoId: string) {
        const instance = await prisma.metroInstance.findUnique({
            where: { repoId },
        });

        if (!instance) {
            throw new Error(`Metro instance not found for repo ${repoId}`);
        }

        logger.info(`Triggering hot reload for repo ${repoId}`);

        // In a real implementation, you might send a signal to Metro or
        // use Metro CLI commands to invalidate cache
        // For now, we just update the activity timestamp
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
     * Get Metro URL for a repository
     */
    async getMetroUrl(repoId: string): Promise<string | null> {
        const instance = await prisma.metroInstance.findUnique({
            where: { repoId },
        });

        if (!instance || instance.status !== 'READY') {
            return null;
        }

        // Assuming Metro is accessible via host machine
        return `http://localhost:${instance.httpPort}`;
    }

    /**
     * Cleanup idle Metro instances
     */
    async cleanupIdle() {
        const idleThreshold = new Date(Date.now() - 3600 * 1000); // 1 hour

        const idleInstances = await prisma.metroInstance.findMany({
            where: {
                lastActivity: {
                    lt: idleThreshold,
                },
                status: 'READY',
            },
        });

        logger.info(`Found ${idleInstances.length} idle Metro instances`);

        for (const instance of idleInstances) {
            try {
                await this.stopMetro(instance.repoId);
                logger.info(`Stopped idle Metro instance for repo ${instance.repoId}`);
            } catch (error) {
                logger.error(`Failed to stop Metro instance ${instance.id}:`, error);
            }
        }
    }
}
