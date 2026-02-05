import { io, Socket } from 'socket.io-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001';

let socket: Socket | null = null;

export function getSocket(): Socket {
    if (!socket) {
        socket = io(WS_URL, {
            withCredentials: true,
            autoConnect: true,
        });

        socket.on('connect', () => {
            console.log('✅ Socket connected:', socket!.id);
        });

        socket.on('disconnect', () => {
            console.log('❌ Socket disconnected');
        });

        socket.on('error', (error) => {
            console.error('Socket error:', error);
        });
    }

    return socket;
}

export function subscribeTouild(buildId: string) {
    const socket = getSocket();
    socket.emit('subscribe:build', buildId);
}

export function subscribeToSession(sessionId: string) {
    const socket = getSocket();
    socket.emit('subscribe:session', sessionId);
}

export function disconnectSocket() {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
}
