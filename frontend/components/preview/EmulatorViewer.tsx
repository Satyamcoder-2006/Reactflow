'use client';

import { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api/client';

interface EmulatorViewerProps {
    sessionId: string;
}

export function EmulatorViewer({ sessionId }: EmulatorViewerProps) {
    const imgRef = useRef<HTMLImageElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isConnected, setIsConnected] = useState(true); // Assume connected for stream
    const [streamUrl, setStreamUrl] = useState<string>('');

    // Swipe state
    const touchStart = useRef<{ x: number, y: number } | null>(null);

    useEffect(() => {
        // Use the new MJPEG stream endpoint
        // Add timestamp to prevent caching on mount
        setStreamUrl(`${process.env.NEXT_PUBLIC_API_URL}/sessions/${sessionId}/stream?t=${Date.now()}`);

        return () => {
            setStreamUrl('');
        };
    }, [sessionId]);

    const getCoordinates = (clientX: number, clientY: number) => {
        if (!imgRef.current) return null;
        const rect = imgRef.current.getBoundingClientRect();

        // Native device definition (Pixel 4ish)
        const DEVICE_WIDTH = 1080;
        const DEVICE_HEIGHT = 2400;

        const scaleX = DEVICE_WIDTH / rect.width;
        const scaleY = DEVICE_HEIGHT / rect.height;

        const x = (clientX - rect.left) * scaleX;
        const y = (clientY - rect.top) * scaleY;

        return { x: Math.round(x), y: Math.round(y) };
    };

    const handleClick = async (e: React.MouseEvent<HTMLImageElement>) => {
        const coords = getCoordinates(e.clientX, e.clientY);
        if (!coords) return;

        await apiClient.sendInput(sessionId, {
            type: 'tap',
            x: coords.x,
            y: coords.y,
        });
    };

    const handleTouchStart = (e: React.TouchEvent) => {
        const touch = e.touches[0];
        const coords = getCoordinates(touch.clientX, touch.clientY);
        if (coords) {
            touchStart.current = coords;
        }
    };

    const handleTouchEnd = async (e: React.TouchEvent) => {
        if (!touchStart.current) return;

        const touch = e.changedTouches[0];
        const endCoords = getCoordinates(touch.clientX, touch.clientY);

        if (endCoords) {
            const dx = endCoords.x - touchStart.current.x;
            const dy = endCoords.y - touchStart.current.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > 20) {
                // It's a swipe
                await apiClient.sendInput(sessionId, {
                    type: 'swipe',
                    x: touchStart.current.x,
                    y: touchStart.current.y,
                    x2: endCoords.x,
                    y2: endCoords.y
                });
            } else {
                // Regular tap fallback handled by onClick usually, but for touch devices:
                await apiClient.sendInput(sessionId, {
                    type: 'tap',
                    x: endCoords.x,
                    y: endCoords.y,
                });
            }
        }
        touchStart.current = null;
    };

    const handleKeyDown = async (e: React.KeyboardEvent) => {
        if (e.key === 'Backspace') {
            await apiClient.sendInput(sessionId, { type: 'key', key: 'KEYCODE_DEL' });
        } else if (e.key === 'Enter') {
            await apiClient.sendInput(sessionId, { type: 'key', key: 'KEYCODE_ENTER' });
        } else if (e.key.length === 1) {
            await apiClient.sendInput(sessionId, { type: 'text', text: e.key });
        }
    };

    return (
        <div className="relative">
            {/* 
              We use a simple img tag pointing to the stream.
              The 'key' prop forces a remount if streamUrl changes significantly.
            */}
            <div
                ref={containerRef}
                className="relative mx-auto max-w-sm outline-none"
                tabIndex={0}
                onKeyDown={handleKeyDown}
            >
                {streamUrl && (
                    <img
                        ref={imgRef}
                        src={streamUrl}
                        alt="Emulator Stream"
                        className="w-full rounded-lg shadow-2xl border border-border cursor-crosshair bg-black min-h-[400px]"
                        onClick={handleClick}
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                        draggable={false}
                    />
                )}

                {isConnected && (
                    <div className="absolute top-2 right-2 px-2 py-1 bg-green-500/90 text-white text-xs rounded-md pointer-events-none">
                        Live MJPEG
                    </div>
                )}
            </div>

            <div className="mt-2 text-center text-xs text-muted-foreground">
                <p>Click to tap • Drag to swipe • Type to send text</p>
            </div>
        </div>
    );
}
