import { FastifyInstance } from 'fastify';
import { prisma } from '../db/prisma';
import { addShellBuildJob } from '../queues/build.queue';
import { authenticateUser } from '../middleware/auth.middleware';
import { createBuildSchema, listBuildsSchema, buildDetailSchema } from '../schemas/build.schema';
import { handlePrismaError } from '../utils/error-handler';

export async function buildRoutes(app: FastifyInstance) {
    // Authenticate all routes in this plugin
    app.addHook('onRequest', authenticateUser);

    // List builds for repository
    app.get<{
        Params: { repoId: string };
    }>('/repo/:repoId', {
        schema: listBuildsSchema
    }, async (request, reply) => {
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
        Body: { branch?: string; buildType?: 'SHELL' | 'HOT_RELOAD' };
    }>('/repo/:repoId/build', {
        schema: createBuildSchema
    }, async (request, reply) => {
        const { repoId } = request.params;
        const { branch, buildType } = request.body;
        const userId = request.user!.id;

        try {
            const result = await prisma.$transaction(async (tx) => {
                const repo = await tx.repo.findFirst({
                    where: { id: repoId, userId },
                });

                if (!repo) {
                    throw new Error('NOT_FOUND');
                }

                // Create build record
                const build = await tx.build.create({
                    data: {
                        repo: { connect: { id: repoId } },
                        user: { connect: { id: userId } },
                        branch: branch || repo.defaultBranch,
                        commit: 'HEAD', // Will be resolved during build
                        buildType: buildType || 'SHELL',
                        triggerType: 'MANUAL',
                        status: 'QUEUED',
                    },
                });

                return { build, repo };
            });

            const { build, repo } = result;

            // Queue build job
            await addShellBuildJob({
                buildId: build.id,
                repoId,
                userId,
                repoUrl: `https://github.com/${repo.fullName}`,
                branch: build.branch,
                commit: 'HEAD',
            });

            return { build };
        } catch (error: any) {
            if (error.message === 'NOT_FOUND') {
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
