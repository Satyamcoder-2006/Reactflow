import { prisma } from '../db/prisma';
import { StorageService } from './storage.service';
import { generateDependencyHash, extractNativeDependencies } from '../utils/hash';
import { logger } from '../utils/logger';

export class ShellService {
    constructor(private storage: StorageService) { }

    /**
     * Get or create a shell APK for the given dependencies
     */
    async getOrCreateShell(repoId: string, packageJson: any) {
        const dependencyHash = generateDependencyHash(packageJson);

        logger.info(`Looking for shell with hash: ${dependencyHash}`);

        // Check if shell exists
        let shell = await prisma.shell.findUnique({
            where: { dependencyHash },
        });

        if (shell) {
            logger.info(`✅ Shell cache HIT: ${shell.id}`);

            // Update usage stats
            await prisma.shell.update({
                where: { id: shell.id },
                data: {
                    usageCount: { increment: 1 },
                    lastUsedAt: new Date(),
                },
            });

            // Link to repo if not already linked
            await prisma.repoShell.upsert({
                where: {
                    repoId_shellId: { repoId, shellId: shell.id },
                },
                create: {
                    repoId,
                    shellId: shell.id,
                    isCurrent: true,
                },
                update: {
                    isCurrent: true,
                },
            });

            return { shell, cached: true };
        }

        logger.info(`❌ Shell cache MISS - will need to build`);

        // Shell doesn't exist, need to build
        return { shell: null, cached: false, dependencyHash };
    }

    /**
     * Save a newly built shell
     */
    async saveShell(
        repoId: string,
        dependencyHash: string,
        apkUrl: string,
        metadata: {
            apkSize: number;
            buildTime: number;
            reactNativeVersion: string;
            expoVersion?: string;
            dependencies: any;
            gradleVersion?: string;
            androidSdkVersion?: number;
        }
    ) {
        logger.info(`Saving new shell with hash: ${dependencyHash}`);

        const shell = await prisma.shell.create({
            data: {
                dependencyHash,
                apkUrl,
                apkSize: metadata.apkSize,
                buildTime: metadata.buildTime,
                reactNativeVersion: metadata.reactNativeVersion,
                expoVersion: metadata.expoVersion,
                dependencies: metadata.dependencies,
                gradleVersion: metadata.gradleVersion,
                androidSdkVersion: metadata.androidSdkVersion,
                usageCount: 1,
            },
        });

        // Link to repo
        await prisma.repoShell.create({
            data: {
                repoId,
                shellId: shell.id,
                isCurrent: true,
            },
        });

        logger.info(`✅ Shell saved: ${shell.id}`);

        return shell;
    }

    /**
     * Get current shell for repository
     */
    async getCurrentShell(repoId: string) {
        const repoShell = await prisma.repoShell.findFirst({
            where: {
                repoId,
                isCurrent: true,
            },
            include: {
                shell: true,
            },
        });

        return repoShell?.shell || null;
    }

    /**
     * List all shells ordered by usage
     */
    async listShells(limit: number = 50) {
        return prisma.shell.findMany({
            orderBy: {
                usageCount: 'desc',
            },
            take: limit,
        });
    }

    /**
     * Calculate total storage used by shells
     */
    async getTotalStorageUsed(): Promise<number> {
        const result = await prisma.shell.aggregate({
            _sum: {
                apkSize: true,
            },
        });

        return result._sum.apkSize || 0;
    }
}
