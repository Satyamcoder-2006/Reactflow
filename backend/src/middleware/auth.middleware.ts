import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Middleware to authenticate requests using JWT
 */
export async function authenticateUser(
    request: FastifyRequest,
    reply: FastifyReply
) {
    try {
        await request.jwtVerify();

        if (!request.user) {
            throw new Error('User not found in token');
        }
    } catch (err) {
        return reply.code(401).send({
            error: 'Unauthorized',
            message: 'Invalid or expired token',
        });
    }
}

// Type augmentation for Fastify
declare module 'fastify' {
    interface FastifyRequest {
        user: {
            id: string;
            email: string;
            githubUsername: string;
        };
    }
}
