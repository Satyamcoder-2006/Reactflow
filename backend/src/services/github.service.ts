import { Octokit } from '@octokit/rest';
import { execSync } from 'child_process';
import { logger } from '../utils/logger';

export class GitHubService {
    private octokit: Octokit;

    constructor(token: string) {
        this.octokit = new Octokit({ auth: token });
    }

    /**
     * List repositories for authenticated user
     */
    async listRepositories() {
        const { data } = await this.octokit.repos.listForAuthenticatedUser({
            per_page: 100,
            sort: 'updated',
            affiliation: 'owner,collaborator',
        });
        return data;
    }

    /**
     * Get repository details
     */
    async getRepository(owner: string, repo: string) {
        const { data } = await this.octokit.repos.get({ owner, repo });
        return data;
    }

    /**
     * Create webhook for repository
     */
    async createWebhook(owner: string, repo: string, callbackUrl: string, secret: string) {
        const { data } = await this.octokit.repos.createWebhook({
            owner,
            repo,
            config: {
                url: callbackUrl,
                content_type: 'json',
                secret,
                insecure_ssl: '0',
            },
            events: ['push', 'pull_request'],
            active: true,
        });

        logger.info(`Webhook created for ${owner}/${repo}: ${data.id}`);
        return { webhookId: String(data.id), secret };
    }

    /**
     * Delete webhook
     */
    async deleteWebhook(owner: string, repo: string, hookId: string) {
        await this.octokit.repos.deleteWebhook({
            owner,
            repo,
            hook_id: parseInt(hookId),
        });
        logger.info(`Webhook deleted for ${owner}/${repo}: ${hookId}`);
    }

    /**
     * Compare commits to detect changes
     */
    async compareCommits(owner: string, repo: string, base: string, head: string) {
        const { data } = await this.octokit.repos.compareCommits({
            owner,
            repo,
            base,
            head,
        });
        return data;
    }

    /**
     * Get package.json from repository
     */
    async getPackageJson(owner: string, repo: string, ref: string = 'main') {
        try {
            const { data } = await this.octokit.repos.getContent({
                owner,
                repo,
                path: 'package.json',
                ref,
            });

            if ('content' in data) {
                const content = Buffer.from(data.content, 'base64').toString('utf-8');
                return JSON.parse(content);
            }

            return null;
        } catch (error) {
            logger.error(`Failed to fetch package.json for ${owner}/${repo}@${ref}:`, error);
            return null;
        }
    }

    /**
     * Clone repository to local filesystem
     */
    async cloneRepository(repoUrl: string, targetPath: string, branch: string = 'main') {
        const command = `git clone --depth 1 --branch ${branch} ${repoUrl} ${targetPath}`;
        logger.info(`Cloning repository: ${command}`);

        try {
            execSync(command, { stdio: 'inherit' });
            logger.info(`Repository cloned to ${targetPath}`);
        } catch (error) {
            logger.error(`Failed to clone repository:`, error);
            throw new Error(`Git clone failed: ${error}`);
        }
    }

    /**
     * Get authenticated user info
     */
    async getAuthenticatedUser() {
        const { data } = await this.octokit.users.getAuthenticated();
        return data;
    }

    /**
     * Verify webhook signature
     */
    static verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
        const crypto = require('crypto');
        const hmac = crypto.createHmac('sha256', secret);
        const digest = 'sha256=' + hmac.update(payload).digest('hex');
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
    }
}
