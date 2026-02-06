import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/prisma';
import { encrypt } from '../utils/crypto';
import { env } from '../config/env';

export async function authRoutes(app: FastifyInstance) {
    // GitHub OAuth - exchange code for token
    app.post<{
        Body: { code: string };
    }>('/github', async (request, reply) => {
        const { code } = request.body;

        try {
            // Exchange code for access token
            const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify({
                    client_id: env.GITHUB_CLIENT_ID,
                    client_secret: env.GITHUB_CLIENT_SECRET,
                    code,
                }),
            });

            const tokenData = await tokenResponse.json();

            if (tokenData.error) {
                return reply.code(400).send({ error: tokenData.error_description });
            }

            const accessToken = tokenData.access_token;

            // Get user info from GitHub
            const userResponse = await fetch('https://api.github.com/user', {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: 'application/vnd.github.v3+json',
                },
            });

            const githubUser = await userResponse.json();

            // Create or update user
            const user = await prisma.user.upsert({
                where: { githubId: String(githubUser.id) },
                create: {
                    githubId: String(githubUser.id),
                    email: githubUser.email || `${githubUser.login}@github.local`,
                    name: githubUser.name || githubUser.login,
                    avatarUrl: githubUser.avatar_url,
                    githubUsername: githubUser.login,
                    githubToken: encrypt(accessToken, env.JWT_SECRET),
                    plan: 'FREE',
                },
                update: {
                    name: githubUser.name || githubUser.login,
                    avatarUrl: githubUser.avatar_url,
                    githubToken: encrypt(accessToken, env.JWT_SECRET),
                    lastLoginAt: new Date(),
                },
            });

            // Generate JWT
            const token = app.jwt.sign({
                id: user.id,
                email: user.email,
                githubUsername: user.githubUsername,
            });

            return { token, user: { id: user.id, email: user.email, name: user.name } };
        } catch (error: any) {
            app.log.error('GitHub OAuth error:', error);
            return reply.code(500).send({ error: 'Authentication failed' });
        }
    });

    // Get current user
    app.get('/user', async (request, reply) => {
        try {
            await request.jwtVerify();
            const userId = (request.user as any).id;

            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    email: true,
                    name: true,
                    avatarUrl: true,
                    githubUsername: true,
                    plan: true,
                    createdAt: true,
                },
            });

            if (!user) {
                return reply.code(404).send({ error: 'User not found' });
            }

            return { user };
        } catch (error) {
            return reply.code(401).send({ error: 'Unauthorized' });
        }
    });

    // Logout
    app.post('/logout', async (request, reply) => {
        return { success: true };
    });
}
