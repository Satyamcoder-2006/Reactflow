import { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { prisma } from '../db/prisma';
import { addShellBuildJob, triggerSessionStart } from '../queues/build.queue';
import { authenticateUser } from '../middleware/auth.middleware';
import { createBuildSchema, listBuildsSchema, buildDetailSchema } from '../schemas/build.schema';
import { handlePrismaError } from '../utils/error-handler';
import { decrypt } from '../utils/crypto';
import { env } from '../config/env';

export async function buildRoutes(app: FastifyInstance) {
    // Authenticate all routes in this plugin
    app.addHook('onRequest', authenticateUser);

    // Register rate limit
    await app.register(rateLimit, {
        max: 50,
        timeWindow: '1 hour',
        keyGenerator: (request) => request.user!.id,
    });

    // List builds for repository
    app.get<{
        Params: { repoId: string };
    }>('/repo/:repoId', {
        schema: listBuildsSchema
    }, async (request: any, reply) => {
        const { repoId } = request.params;
        const userId = request.user!.id;

        try {
            // Verify repo ownership
            const repo = await prisma.repo.findFirst({
                where: { id: repoId, userId },
            });

            if (!repo) {
                return reply.code(404).send({ error: 'Repository not found' });
            }

            const builds = await prisma.build.findMany({
                where: { repoId },
                orderBy: { queuedAt: 'desc' },
                take: 50,
            });

            return { builds };
        } catch (error: any) {
            const appError = handlePrismaError(error);
            return reply.code(appError.statusCode).send({
                error: appError.code,
                message: appError.message
            });
        }
    });

    // Trigger manual build
    app.post<{
        Params: { repoId: string };
        Body: {
            branch?: string;
            buildType?: 'SHELL' | 'HOT_RELOAD';
            autoStartSession?: boolean;
            emulatorConfig?: {
                deviceType: string;
                androidVersion: number;
            };
        };
    }>('/repo/:repoId/build', {
        schema: createBuildSchema
    }, async (request, reply) => {
        const { repoId } = request.params;
        const { branch, buildType, autoStartSession, emulatorConfig } = request.body;
        const userId = request.user!.id;

        try {
            // 1. Fetch Repo and User Token
            const repo = await prisma.repo.findFirst({
                where: { id: repoId, userId },
            });

            if (!repo) {
                return reply.code(404).send({ error: 'Repository not found' });
            }

            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { githubToken: true }
            });

            if (!user?.githubToken) {
                return reply.code(400).send({ error: 'GITHUB_TOKEN_MISSING', message: 'GitHub token not found' });
            }

            // 2. Resolve target branch and fetch latest commit from GitHub using Octokit
            const targetBranch = branch || repo.defaultBranch;
            const { Octokit } = await import('@octokit/rest');
            const decryptedToken = decrypt(user.githubToken, env.JWT_SECRET);
            const octokit = new Octokit({ auth: decryptedToken });

            let commitSha: string;
            try {
                const { data: branchData } = await octokit.repos.getBranch({
                    owner: repo.owner,
                    repo: repo.name,
                    branch: targetBranch
                });
                commitSha = branchData.commit.sha;
            } catch (githubError: any) {
                app.log.error(`GitHub API error: ${githubError.message}`);
                return reply.code(400).send({
                    error: 'GIT_REF_NOT_FOUND',
                    message: `Could not find branch '${targetBranch}' in repository`
                });
            }

            // 3. Check for existing builds to deduplicate
            const existingBuild = await prisma.build.findFirst({
                where: {
                    repoId,
                    commit: commitSha,
                    status: { in: ['QUEUED', 'BUILDING', 'SUCCESS'] }
                }
            });

            if (existingBuild) {
                // If a successful build exists and autoStart is true, trigger session
                if (existingBuild.status === 'SUCCESS' && autoStartSession) {
                    await triggerSessionStart({
                        userId,
                        repoId,
                        buildId: existingBuild.id,
                        emulatorConfig
                    });

                    return reply.send({
                        build: existingBuild,
                        message: 'Build already exists. Starting emulator session...'
                    });
                }

                return reply.send({
                    build: existingBuild,
                    message: existingBuild.status === 'SUCCESS'
                        ? 'Build already exists for this commit'
                        : 'Build already in progress for this commit'
                });
            }

            // 4. Create new build and queue job
            const result = await prisma.$transaction(async (tx) => {
                const build = await tx.build.create({
                    data: {
                        repoId,
                        userId,
                        branch: targetBranch,
                        commit: commitSha,
                        buildType: buildType || 'SHELL',
                        status: 'QUEUED',
                        triggerType: 'MANUAL',
                    },
                });

                if (build.buildType === 'SHELL') {
                    await addShellBuildJob({
                        buildId: build.id,
                        repoId,
                        userId,
                        repoUrl: `https://github.com/${repo.fullName}`,
                        branch: targetBranch,
                        commit: commitSha,
                        autoStartSession: autoStartSession || false,
                        emulatorConfig,
                    });
                }

                return build;
            });

            return reply.send({
                build: result,
                message: autoStartSession
                    ? 'Build queued. Emulator will start automatically upon completion.'
                    : 'Build queued'
            });
        } catch (error: any) {
            if (error.message === 'REPO_NOT_FOUND') {
                return reply.code(404).send({ error: 'Repository not found' });
            }
            const appError = handlePrismaError(error);
            return reply.code(appError.statusCode).send({
                error: appError.code,
                message: appError.message
            });
        }
    });

    // Get build details
    app.get<{
        Params: { id: string };
    }>('/:id', {
        schema: buildDetailSchema
    }, async (request, reply) => {
        const { id } = request.params;
        const userId = request.user!.id;

        try {
            const build = await prisma.build.findFirst({
                where: { id, userId },
                include: {
                    repo: true,
                    logs: {
                        orderBy: { timestamp: 'asc' },
                        take: 1000,
                    },
                },
            });

            if (!build) {
                return reply.code(404).send({ error: 'Build not found' });
            }

            return { build };
        } catch (error: any) {
            const appError = handlePrismaError(error);
            return reply.code(appError.statusCode).send({
                error: appError.code,
                message: appError.message
            });
        }
    });

    // Get build logs
    app.get<{
        Params: { id: string };
    }>('/:id/logs', {
        schema: buildDetailSchema
    }, async (request, reply) => {
        const { id } = request.params;
        const userId = request.user!.id;

        try {
            const build = await prisma.build.findFirst({
                where: { id, userId },
            });

            if (!build) {
                return reply.code(404).send({ error: 'Build not found' });
            }

            const logs = await prisma.buildLog.findMany({
                where: { buildId: id },
                orderBy: { timestamp: 'asc' },
                take: 5000,
            });

            return { build, logs };
        } catch (error: any) {
            const appError = handlePrismaError(error);
            return reply.code(appError.statusCode).send({
                error: appError.code,
                message: appError.message
            });
        }
    });

    // Cancel build
    app.delete<{
        Params: { id: string };
    }>('/:id', {
        schema: buildDetailSchema
    }, async (request, reply) => {
        const { id } = request.params;
        const userId = request.user!.id;

        try {
            const build = await prisma.build.findFirst({
                where: { id, userId },
            });

            if (!build) {
                return reply.code(404).send({ error: 'Build not found' });
            }

            if (build.status === 'BUILDING' || build.status === 'QUEUED') {
                await prisma.build.update({
                    where: { id },
                    data: {
                        status: 'CANCELLED',
                        completedAt: new Date(),
                    },
                });
            }

            return { success: true };
        } catch (error: any) {
            const appError = handlePrismaError(error);
            return reply.code(appError.statusCode).send({
                error: appError.code,
                message: appError.message
            });
        }
    });
}
