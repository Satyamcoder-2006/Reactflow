'use client';

import { useEffect, useRef, useState } from 'react';
import SimplePeer from 'simple-peer';
import { getSocket, subscribeToSession } from '@/lib/utils/socket';
import { apiClient } from '@/lib/api/client';

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

        // Join session room via Socket.IO
        socket.emit('subscribe:session', sessionId);

        const initPeer = async () => {
            try {
                // Get ICE servers configuration
                const { data: { iceServers } } = await apiClient.getIceServers();

                // Initialize WebRTC peer
                const peer = new SimplePeer({
                    initiator: true,
                    trickle: false,
                    config: {
                        iceServers: iceServers || [
                            { urls: 'stun:stun.l.google.com:19302' },
                            { urls: 'stun:stun1.l.google.com:19302' },
                        ],
                    },
                });

                peerRef.current = peer;

                // Send offer to emulator (via backend)
                peer.on('signal', async (signal) => {
                    // Cast to any because SimplePeer.SignalData is a union that's hard to narrow
                    const s = signal as any;

                    if (s.type === 'offer') {
                        await apiClient.sendSignal({
                            sessionId,
                            type: 'offer',
                            data: s,
                        });
                    } else if (s.candidate) {
                        await apiClient.sendSignal({
                            sessionId,
                            type: 'ice-candidate',
                            data: s,
                        });
                    }
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

                // Listen for signals from backend
                socket.on('webrtc:signal', (message: { type: string, data: any, sessionId: string }) => {
                    if (message.sessionId !== sessionId) return;

                    if (message.type === 'answer') {
                        peer.signal(message.data);
                    } else if (message.type === 'ice-candidate') {
                        peer.signal(message.data);
                    }
                });

            } catch (err: any) {
                console.error('Failed to init peer:', err);
                setError(err.message);
            }
        };

        if (sessionId) {
            initPeer();
        }

        return () => {
            if (peerRef.current) {
                peerRef.current.destroy();
                peerRef.current = null;
            }
            socket.off('webrtc:signal');
        };
    }, [sessionId]);

    const handleClick = async (e: React.MouseEvent<HTMLVideoElement>) => {
        if (!videoRef.current) return;

        const rect = videoRef.current.getBoundingClientRect();
        // Redroid standard resolution is often 720x1280 or similar, scaling needs to match
        // For now hardcoding but should be dynamic or standard
        const scaleX = 1080 / rect.width;
        const scaleY = 2400 / rect.height;

        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        // Send tap command
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
                <div className="absolute inset-0 flex items-center justify-center bg-secondary rounded-lg border border-border z-10 h-[600px]">
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
                    className="w-full rounded-lg shadow-2xl border border-border cursor-crosshair bg-black"
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
