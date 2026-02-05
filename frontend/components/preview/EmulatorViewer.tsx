'use client';

import { useEffect, useRef, useState } from 'react';
import SimplePeer from 'simple-peer';
import { getSocket } from '@/lib/utils/socket';

interface EmulatorViewerProps {
    sessionId: string;
}

export function EmulatorViewer({ sessionId }: EmulatorViewerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const peerRef = useRef<SimplePeer.Instance | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const socket = getSocket();

        socket.emit('join', { sessionId });

        // Initialize WebRTC peer
        const peer = new SimplePeer({
            initiator: true,
            trickle: false,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                ],
            },
        });

        peerRef.current = peer;

        // Send offer to emulator
        peer.on('signal', (signal) => {
            socket.emit('offer', { sessionId, signal });
        });

        // Receive answer from emulator
        socket.on('answer', (answer) => {
            peer.signal(answer);
        });

        // Handle ICE candidates
        socket.on('ice-candidate', (candidate) => {
            peer.signal(candidate);
        });

        // Receive video stream
        peer.on('stream', (stream) => {
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                setIsConnected(true);
            }
        });

        peer.on('error', (err) => {
            console.error('WebRTC error:', err);
            setError(err.message);
        });

        peer.on('close', () => {
            setIsConnected(false);
        });

        return () => {
            peer.destroy();
        };
    }, [sessionId]);

    const handleClick = async (e: React.MouseEvent<HTMLVideoElement>) => {
        if (!videoRef.current) return;

        const rect = videoRef.current.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 1080;
        const y = ((e.clientY - rect.top) / rect.height) * 2400;

        // Send tap command
        const { apiClient } = await import('@/lib/api/client');
        await apiClient.sendInput(sessionId, {
            type: 'tap',
            x: Math.round(x),
            y: Math.round(y),
        });
    };

    if (error) {
        return (
            <div className="flex items-center justify-center h-[600px] bg-secondary rounded-lg border border-border">
                <div className="text-center">
                    <p className="text-destructive font-medium mb-2">Connection Error</p>
                    <p className="text-sm text-muted-foreground">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="relative">
            {!isConnected && (
                <div className="absolute inset-0 flex items-center justify-center bg-secondary rounded-lg border border-border z-10">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                        <p className="text-muted-foreground">Connecting to emulator...</p>
                    </div>
                </div>
            )}
            <div className="relative mx-auto max-w-sm">
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    onClick={handleClick}
                    className="w-full rounded-lg shadow-2xl border border-border cursor-crosshair"
                />
                {isConnected && (
                    <div className="absolute top-2 right-2 px-2 py-1 bg-green-500/90 text-white text-xs rounded-md">
                        Live
                    </div>
                )}
            </div>
        </div>
    );
}
