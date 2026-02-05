import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/prisma';
import { shellBuildQueue, hotReloadQueue } from '../workers/index';

export async function buildRoutes(app: FastifyInstance) {
    // List builds for repository
    app.get<{
        Params: { repoId: string };
    }>('/:repoId', async (request, reply) => {
        const { repoId } = request.params;
        const userId = (request.user as any)?.id;

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
    });

    // Trigger manual build
    app.post<{
        Params: { repoId: string };
    }>('/:repoId', async (request, reply) => {
        const { repoId } = request.params;
        const userId = (request.user as any)?.id;

        const repo = await prisma.repo.findFirst({
            where: { id: repoId, userId },
        });

        if (!repo) {
            return reply.code(404).send({ error: 'Repository not found' });
        }

        // Create build record
        const build = await prisma.build.create({
            data: {
                repoId,
                userId,
                branch: repo.defaultBranch,
                commit: 'HEAD', // Will be resolved during build
                buildType: 'SHELL',
                triggerType: 'MANUAL',
                status: 'QUEUED',
            },
        });

        // Queue build job
        await shellBuildQueue.add('manual-build', {
            buildId: build.id,
            repoId,
            userId,
            repoUrl: `https://github.com/${repo.fullName}`,
            branch: repo.defaultBranch,
            commit: 'HEAD',
        });

        return { build };
    });

    // Get build details
    app.get<{
        Params: { id: string };
    }>('/build/:id', async (request, reply) => {
        const { id } = request.params;

        const build = await prisma.build.findUnique({
            where: { id },
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
    });

    // Get build logs
    app.get<{
        Params: { id: string };
    }>('/build/:id/logs', async (request, reply) => {
        const { id } = request.params;

        const build = await prisma.build.findUnique({
            where: { id },
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
    });

    // Cancel build
    app.delete<{
        Params: { id: string };
    }>('/build/:id', async (request, reply) => {
        const { id } = request.params;

        const build = await prisma.build.findUnique({
            where: { id },
        });

        if (!build) {
            return reply.code(404).send({ error: 'Build not found' });
        }

        if (build.status === 'BUILDING') {
            await prisma.build.update({
                where: { id },
                data: {
                    status: 'CANCELLED',
                    completedAt: new Date(),
                },
            });
        }

        return { success: true };
    });
}
