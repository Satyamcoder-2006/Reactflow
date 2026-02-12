import { io, Socket } from 'socket.io-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001';

let socket: Socket | null = null;

export function getSocket(): Socket {
    if (!socket) {
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

        socket = io(WS_URL, {
            withCredentials: true,
            autoConnect: true,
            auth: { token },
            transports: ['websocket'],
        });

        socket.on('connect', () => {
            console.log('✅ Socket connected:', socket!.id);
        });

        socket.on('disconnect', (reason) => {
            console.log('❌ Socket disconnected:', reason);
        });

        socket.on('connect_error', (error) => {
            console.error('Socket connection error:', error.message);
            if (error.message.includes('Authentication failed')) {
                // Potential logout or refresh token logic
            }
        });
    }

    return socket;
}

export function subscribeToBuild(buildId: string) {
    const socket = getSocket();
    socket.emit('subscribe:build', buildId);
}

export function subscribeToSession(sessionId: string) {
    const socket = getSocket();
    socket.emit('subscribe:session', sessionId);
}

export function subscribeToUser(userId: string) {
    const socket = getSocket();
    // No explicit emit needed if the backend automatically joins user to room on connection
    // But we can add it for clarity or manual room joining if needed.
}

export function disconnectSocket() {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
}
