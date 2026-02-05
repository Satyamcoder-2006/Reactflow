import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/prisma';
import { GitHubService } from '../services/github.service';
import { ChangeDetectionService } from '../services/change-detection.service';
import { ShellService } from '../services/shell.service';
import { StorageService } from '../services/storage.service';
import { shellBuildQueue, hotReloadQueue } from '../workers/index';
import { decrypt } from '../utils/crypto';
import { env } from '../config/env';

export async function webhookRoutes(app: FastifyInstance) {
    // GitHub webhook handler
    app.post<{
        Headers: { 'x-hub-signature-256': string };
        Body: any;
    }>('/github', async (request, reply) => {
        const signature = request.headers['x-hub-signature-256'];
        const payload = JSON.stringify(request.body);

        // Determine repository from payload
        const repoFullName = request.body.repository?.full_name;
        if (!repoFullName) {
            return reply.code(400).send({ error: 'Invalid payload' });
        }

        // Find repository
        const repo = await prisma.repo.findFirst({
            where: { fullName: repoFullName },
            include: { user: true },
        });

        if (!repo) {
            return reply.code(404).send({ error: 'Repository not configured' });
        }

        // Verify webhook signature
        const webhookSecret = decrypt(repo.webhookSecret!, env.JWT_SECRET);
        const isValid = GitHubService.verifyWebhookSignature(payload, signature, webhookSecret);

        if (!isValid) {
            return reply.code(401).send({ error: 'Invalid signature' });
        }

        // Handle push event
        if (request.body.ref && request.body.after) {
            const branch = request.body.ref.replace('refs/heads/', '');
            const afterCommit = request.body.after;
            const beforeCommit = request.body.before;
            const commitMessage = request.body.head_commit?.message;
            const commitAuthor = request.body.head_commit?.author?.name;

            // Initialize services
            const github = new GitHubService(repo.user.githubToken);
            const changeDetection = new ChangeDetectionService(github);
            const storageService = new StorageService();
            const shellService = new ShellService(storageService);

            // Analyze changes
            const analysis = await changeDetection.analyzeChanges(
                repo.id,
                repo.owner,
                repo.name,
                beforeCommit,
                afterCommit
            );

            if (analysis.actionTaken === 'SHELL_REBUILD') {
                // Full native rebuild required
                const packageJson = await github.getPackageJson(repo.owner, repo.name, afterCommit);

                if (packageJson) {
                    const { shell, cached, dependencyHash } = await shellService.getOrCreateShell(
                        repo.id,
                        packageJson
                    );

                    if (!cached) {
                        // Queue shell build
                        const build = await prisma.build.create({
                            data: {
                                repoId: repo.id,
                                userId: repo.userId,
                                branch,
                                commit: afterCommit,
                                commitMessage,
                                commitAuthor,
                                buildType: 'SHELL',
                                triggerType: 'WEBHOOK',
                                status: 'QUEUED',
                            },
                        });

                        await shellBuildQueue.add('webhook-build', {
                            buildId: build.id,
                            repoId: repo.id,
                            userId: repo.userId,
                            repoUrl: `https://github.com/${repo.fullName}`,
                            branch,
                            commit: afterCommit,
                            packageJson,
                            dependencyHash: dependencyHash!,
                        });
                    }
                }
            } else if (analysis.actionTaken === 'HOT_RELOAD') {
                // JS-only changes - hot reload
                const build = await prisma.build.create({
                    data: {
                        repoId: repo.id,
                        userId: repo.userId,
                        branch,
                        commit: afterCommit,
                        commitMessage,
                        commitAuthor,
                        buildType: 'HOT_RELOAD',
                        triggerType: 'WEBHOOK',
                        status: 'QUEUED',
                    },
                });

                await hotReloadQueue.add('hot-reload', {
                    buildId: build.id,
                    repoId: repo.id,
                    repoPath: `/repos/${repo.fullName}`,
                    commit: afterCommit,
                    changedFiles: analysis.changedFiles,
                });
            }

            return { success: true, action: analysis.actionTaken };
        }

        return { success: true };
    });
}
