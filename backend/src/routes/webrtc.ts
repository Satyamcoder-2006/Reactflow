import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/prisma';

interface WebRTCSignal {
    type: 'offer' | 'answer' | 'ice-candidate';
    sessionId: string;
    data: any;
}

export async function webrtcRoutes(app: FastifyInstance) {
    // WebRTC signaling endpoint
    app.post<{
        Body: WebRTCSignal;
    }>('/signal', async (request, reply) => {
        const { type, sessionId, data } = request.body;

        // Verify session exists
        const session = await prisma.emulatorSession.findUnique({
            where: { id: sessionId },
        });

        if (!session) {
            return reply.code(404).send({ error: 'Session not found' });
        }

        // Broadcast signal to connected clients via Socket.IO
        const io = app.io;
        io.to(`session:${sessionId}`).emit('webrtc:signal', {
            type,
            data,
            sessionId,
        });

        return { success: true };
    });

    // Get ICE servers configuration
    app.get('/ice-servers', async (request, reply) => {
        // In production, use TURN servers for NAT traversal
        const iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ];

        // Add TURN servers if configured
        if (process.env.TURN_SERVER_URL) {
            iceServers.push({
                urls: process.env.TURN_SERVER_URL,
                username: process.env.TURN_SERVER_USERNAME,
                credential: process.env.TURN_SERVER_CREDENTIAL,
            } as any);
        }

        return { iceServers };
    });
}
