import { FastifyRequest } from 'fastify';

declare module 'fastify' {
    interface FastifyRequest {
        user?: {
            id: string;
            email: string;
            githubUsername: string;
        };
    }
}

declare module '@fastify/jwt' {
    interface FastifyJWT {
        user: {
            id: string;
            email: string;
            githubUsername: string;
        };
    }
}
