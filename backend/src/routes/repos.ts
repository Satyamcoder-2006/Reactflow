import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/prisma';
import { GitHubService } from '../services/github.service';
import { ShellService } from '../services/shell.service';
import { StorageService } from '../services/storage.service';
import { shellBuildQueue } from '../workers/index';
import { encrypt, decrypt, generateToken } from '../utils/crypto';
import { env } from '../config/env';
import { authenticateUser } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';

/**
 * Detects if a project is React Native or Expo
 */
async function isReactNativeProject(packageJson: any): Promise<{ isRN: boolean; framework: 'REACT_NATIVE' | 'EXPO' }> {
    const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
    };

    const isExpo = !!deps['expo'];
    const isRN = !!deps['react-native'] || isExpo;

    return {
        isRN,
        framework: isExpo ? 'EXPO' : 'REACT_NATIVE'
    };
}

export async function repoRoutes(app: FastifyInstance) {
    // Authenticate all routes
    app.addHook('onRequest', authenticateUser);

    // List connected repositories
    app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = (request.user as any)?.id;

        const repos = await prisma.repo.findMany({
            where: { userId },
            include: {
                shells: {
                    where: { isCurrent: true },
                    include: { shell: true },
                },
                builds: {
                    orderBy: { queuedAt: 'desc' },
                    take: 1,
                },
            },
            orderBy: { updatedAt: 'desc' },
        });

        return { repos };
    });

    // List available GitHub repositories
    app.get('/github', async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = (request.user as any)?.id;
        logger.info(`Fetching GitHub repos for user: ${userId}`);

        const user = await prisma.user.findUnique({ where: { id: userId } });

        if (!user) {
            logger.error('User not found in database');
            return reply.code(401).send({ error: 'User not found' });
        }

        try {
            logger.info('Initializing GitHub service with token');
            let decryptedToken: string;
            try {
                decryptedToken = decrypt(user.githubToken, env.JWT_SECRET);
            } catch (decryptError) {
                logger.error(`Failed to decrypt GitHub token: ${decryptError}`);
                return reply.code(401).send({ error: 'Authentication invalid. Please login again.' });
            }

            const github = new GitHubService(decryptedToken);

            logger.info('Calling listRepositories...');
            const repos = await github.listRepositories();
            logger.info(`Found ${repos?.length} repositories from GitHub`);

            return { repos };
        } catch (error) {
            logger.error(`Failed to list GitHub repos: ${error}`);
            return reply.code(500).send({ error: `GitHub API error: ${error}` });
        }
    });

    // Connect new repository
    app.post<{
        Body: { githubRepoId: string; fullName: string };
    }>('/', async (request, reply) => {
        const userId = (request.user as any)?.id;
        const { githubRepoId, fullName } = request.body;

        // Get user to access GitHub token
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            return reply.code(401).send({ error: 'User not found' });
        }

        // Initialize GitHub service
        const decryptedToken = decrypt(user.githubToken, env.JWT_SECRET);
        const github = new GitHubService(decryptedToken);

        // Get repository details
        const [owner, name] = fullName.split('/');
        const repoData = await github.getRepository(owner, name);

        // Create webhook (might fail on localhost)
        const webhookUrl = `${env.FRONTEND_URL}/api/webhooks/github`;
        const webhookSecret = generateToken();
        let webhookId: string | undefined;

        try {
            const result = await github.createWebhook(owner, name, webhookUrl, webhookSecret);
            webhookId = result.webhookId;
        } catch (error) {
            request.log.warn(`Failed to create webhook for ${fullName} (likely due to localhost): ${error}`);
            // Continue without webhook - user can still build manually
        }

        // Detect React Native and Verify
        const packageJson = await github.getPackageJson(owner, name, repoData.default_branch);

        if (!packageJson) {
            return reply.code(400).send({
                error: 'INVALID_PROJECT',
                message: 'package.json not found in repository'
            });
        }

        const { isRN, framework } = await isReactNativeProject(packageJson);

        if (!isRN) {
            return reply.code(400).send({
                error: 'NOT_REACT_NATIVE',
                message: 'This repository does not appear to be a React Native project. We currently only support React Native and Expo projects.',
                details: {
                    detected: 'Unknown',
                    supported: ['React Native', 'Expo']
                }
            });
        }

        // Create repo record
        const repo = await prisma.repo.create({
            data: {
                userId,
                githubRepoId,
                fullName,
                owner,
                name,
                defaultBranch: repoData.default_branch || 'main',
                isPrivate: repoData.private,
                webhookId,
                webhookSecret: encrypt(webhookSecret, env.JWT_SECRET),
                framework: framework,
            },
        });

        // Trigger initial build
        if (packageJson) {
            const storageService = new StorageService();
            const shellService = new ShellService(storageService);
            const { shell, cached, dependencyHash } = await shellService.getOrCreateShell(
                repo.id,
                packageJson
            );

            if (!cached) {
                // Queue shell build
                const build = await prisma.build.create({
                    data: {
                        repoId: repo.id,
                        userId,
                        branch: repoData.default_branch,
                        commit: repoData.default_branch, // Will be updated with actual commit
                        buildType: 'SHELL',
                        triggerType: 'MANUAL',
                        status: 'QUEUED',
                    },
                });

                await shellBuildQueue.add('build-shell', {
                    buildId: build.id,
                    repoId: repo.id,
                    userId,
                    repoUrl: repoData.clone_url,
                    branch: repoData.default_branch,
                    commit: repoData.default_branch,
                    packageJson,
                    dependencyHash: dependencyHash!,
                });
            }
        }

        return { repo };
    });

    // Get repository details
    app.get<{
        Params: { id: string };
    }>('/:id', async (request, reply) => {
        const { id } = request.params;
        const userId = (request.user as any)?.id;

        const repo = await prisma.repo.findFirst({
            where: { id, userId },
            include: {
                shells: {
                    where: { isCurrent: true },
                    include: { shell: true },
                },
                builds: {
                    orderBy: { queuedAt: 'desc' },
                    take: 10,
                },
            },
        });

        if (!repo) {
            return reply.code(404).send({ error: 'Repository not found' });
        }

        return { repo };
    });

    // Disconnect repository
    app.delete<{
        Params: { id: string };
    }>('/:id', async (request, reply) => {
        const { id } = request.params;
        const userId = (request.user as any)?.id;

        const repo = await prisma.repo.findFirst({
            where: { id, userId },
        });

        if (!repo) {
            return reply.code(404).send({ error: 'Repository not found' });
        }

        // Get user to delete webhook
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (user && repo.webhookId) {
            const decryptedToken = decrypt(user.githubToken, env.JWT_SECRET);
            const github = new GitHubService(decryptedToken);
            await github.deleteWebhook(repo.owner, repo.name, repo.webhookId);
        }

        // Delete repo (cascades to builds, sessions, etc.)
        await prisma.repo.delete({ where: { id } });

        return { success: true };
    });
}
