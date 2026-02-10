import { FastifyInstance } from 'fastify';
import { prisma } from '../db/prisma';
import { GitHubService } from '../services/github.service';
import { ChangeDetectionService, ChangeType } from '../services/change-detection.service';
import { ShellService } from '../services/shell.service';
import { StorageService } from '../services/storage.service';
import { MetroService } from '../services/metro.service';
import { addShellBuildJob, addHotReloadJob } from '../queues/build.queue';
import { decrypt } from '../utils/crypto';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export async function webhookRoutes(app: FastifyInstance) {
    const metroService = new MetroService();

    // GitHub webhook handler
    app.post<{
        Headers: { 'x-hub-signature-256': string };
        Body: any;
    }>('/github', async (request, reply) => {
        const body = request.body as any;
        const signature = request.headers['x-hub-signature-256'];
        const payload = JSON.stringify(body);

        // Determine repository from payload
        const repoFullName = body.repository?.full_name;
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
        if (body.ref && body.after) {
            const branch = body.ref.replace('refs/heads/', '');
            const afterCommit = body.after;
            const beforeCommit = body.before;
            const commitMessage = body.head_commit?.message;
            const commitAuthor = body.head_commit?.author?.name;

            // Initialize services
            const github = new GitHubService(repo.user.githubToken);
            const changeDetection = new ChangeDetectionService(github);
            const storageService = new StorageService();
            const shellService = new ShellService(storageService);

            // Analyze changes with expanded types
            const analysis = await changeDetection.analyzeChanges(
                repo.id,
                repo.owner,
                repo.name,
                beforeCommit,
                afterCommit
            );

            // Route to appropriate queue based on change type
            switch (analysis.actionTaken) {
                case ChangeType.NATIVE_REBUILD:
                case ChangeType.DEPENDENCY_UPDATE: {
                    // Full native rebuild required
                    const packageJson = await github.getPackageJson(repo.owner, repo.name, afterCommit);

                    if (packageJson) {
                        const { shell, cached, dependencyHash } = await shellService.getOrCreateShell(
                            repo.id,
                            packageJson
                        );

                        if (!cached) {
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

                            // Use deduplication queue
                            await addShellBuildJob({
                                buildId: build.id,
                                repoId: repo.id,
                                userId: repo.userId,
                                repoUrl: `https://github.com/${repo.fullName}`,
                                branch,
                                commit: afterCommit,
                                packageJson,
                                dependencyHash: dependencyHash!,
                            });

                            logger.info(`Queued shell build ${build.id} for ${repo.fullName}`);
                        }
                    }
                    break;
                }

                case ChangeType.METRO_RESTART: {
                    // Restart Metro and then hot reload
                    logger.info(`Metro config changed, restarting Metro for ${repo.fullName}`);
                    await metroService.restartMetro(repo.id, `/repos/${repo.fullName}`);

                    // Queue hot reload after restart
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

                    await addHotReloadJob({
                        buildId: build.id,
                        repoId: repo.id,
                        repoPath: `/repos/${repo.fullName}`,
                        commit: afterCommit,
                        changedFiles: analysis.changedFiles,
                    });
                    break;
                }

                case ChangeType.HOT_RELOAD:
                case ChangeType.ASSET_SYNC: {
                    // JS-only changes or asset sync → hot reload
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

                    await addHotReloadJob({
                        buildId: build.id,
                        repoId: repo.id,
                        repoPath: `/repos/${repo.fullName}`,
                        commit: afterCommit,
                        changedFiles: analysis.changedFiles,
                    });
                    break;
                }

                case ChangeType.NO_ACTION:
                default:
                    logger.info(`No action needed for push to ${repo.fullName}`);
                    break;
            }

            return { success: true, action: analysis.actionTaken };
        }

        return { success: true };
    });
}
