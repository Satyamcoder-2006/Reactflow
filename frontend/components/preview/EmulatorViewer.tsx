'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface EmulatorViewerProps {
    sessionId: string;
    /** Native device width in pixels (default: 412) */
    screenWidth?: number;
    /** Native device height in pixels (default: 892) */
    screenHeight?: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function EmulatorViewer({
    sessionId,
    screenWidth = 412,
    screenHeight = 892,
}: EmulatorViewerProps) {
    const imgRef = useRef<HTMLImageElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const [streamUrl, setStreamUrl] = useState('');
    const [hasError, setHasError] = useState(false);

    // Mouse-swipe detection
    const mouseDown = useRef<{ x: number; y: number; time: number } | null>(null);

    // ── Stream URL ────────────────────────────────────────────────────────────
    useEffect(() => {
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';
        const url = `${API_URL}/api/sessions/${sessionId}/stream?t=${Date.now()}`;
        setStreamUrl(url);
        setHasError(false);

        return () => {
            setStreamUrl('');
        };
    }, [sessionId]);

    // ── Coordinate scaling ────────────────────────────────────────────────────
    const getScaledCoords = useCallback(
        (clientX: number, clientY: number): { x: number; y: number; fw: number; fh: number } | null => {
            if (!imgRef.current) return null;
            const rect = imgRef.current.getBoundingClientRect();
            return {
                x: clientX - rect.left,
                y: clientY - rect.top,
                fw: rect.width,
                fh: rect.height,
            };
        },
        [],
    );

    // ── Send tap ──────────────────────────────────────────────────────────────
    const sendTap = useCallback(
        async (clientX: number, clientY: number) => {
            const coords = getScaledCoords(clientX, clientY);
            if (!coords) return;

            await fetch(`${API_URL}/api/sessions/${sessionId}/tap`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${localStorage.getItem('token') ?? ''}`,
                },
                body: JSON.stringify({
                    x: coords.x,
                    y: coords.y,
                    frontendWidth: coords.fw,
                    frontendHeight: coords.fh,
                }),
            }).catch(() => { /* ignore network errors — non-critical */ });
        },
        [sessionId, getScaledCoords],
    );

    // ── Send swipe ────────────────────────────────────────────────────────────
    const sendSwipe = useCallback(
        async (
            x1: number, y1: number,
            x2: number, y2: number,
            fw: number, fh: number,
            duration: number,
        ) => {
            await fetch(`${API_URL}/api/sessions/${sessionId}/swipe`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${localStorage.getItem('token') ?? ''}`,
                },
                body: JSON.stringify({ x1, y1, x2, y2, duration, frontendWidth: fw, frontendHeight: fh }),
            }).catch(() => { });
        },
        [sessionId],
    );

    // ── Send key ──────────────────────────────────────────────────────────────
    const sendKey = useCallback(
        async (keycode: string) => {
            await fetch(`${API_URL}/api/sessions/${sessionId}/input/key`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${localStorage.getItem('token') ?? ''}`,
                },
                body: JSON.stringify({ keycode }),
            }).catch(() => { });
        },
        [sessionId],
    );

    // ── Mouse handlers (desktop swipe) ────────────────────────────────────────
    const handleMouseDown = (e: React.MouseEvent) => {
        mouseDown.current = { x: e.clientX, y: e.clientY, time: Date.now() };
    };

    const handleMouseUp = async (e: React.MouseEvent) => {
        if (!mouseDown.current || !imgRef.current) return;

        const dx = e.clientX - mouseDown.current.x;
        const dy = e.clientY - mouseDown.current.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const elapsed = Date.now() - mouseDown.current.time;

        if (dist > 10 && elapsed < 500) {
            // Swipe
            const rect = imgRef.current.getBoundingClientRect();
            await sendSwipe(
                mouseDown.current.x - rect.left,
                mouseDown.current.y - rect.top,
                e.clientX - rect.left,
                e.clientY - rect.top,
                rect.width,
                rect.height,
                elapsed,
            );
        }
        // Tap is handled by onClick (fired only when no significant drag)
        mouseDown.current = null;
    };

    const handleClick = async (e: React.MouseEvent<HTMLImageElement>) => {
        await sendTap(e.clientX, e.clientY);
    };

    // ── Touch handlers (mobile) ───────────────────────────────────────────────
    const touchStart = useRef<{ x: number; y: number } | null>(null);

    const handleTouchStart = (e: React.TouchEvent) => {
        const t = e.touches[0];
        touchStart.current = { x: t.clientX, y: t.clientY };
    };

    const handleTouchEnd = async (e: React.TouchEvent) => {
        if (!touchStart.current || !imgRef.current) return;

        const t = e.changedTouches[0];
        const rect = imgRef.current.getBoundingClientRect();
        const dx = t.clientX - touchStart.current.x;
        const dy = t.clientY - touchStart.current.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 20) {
            await sendSwipe(
                touchStart.current.x - rect.left,
                touchStart.current.y - rect.top,
                t.clientX - rect.left,
                t.clientY - rect.top,
                rect.width,
                rect.height,
                300,
            );
        } else {
            await sendTap(t.clientX, t.clientY);
        }

        touchStart.current = null;
    };

    // ── Keyboard shortcuts ────────────────────────────────────────────────────
    const handleKeyDown = async (e: React.KeyboardEvent) => {
        if (e.key === 'r' || e.key === 'R') { await sendKey('KEYCODE_R'); return; }
        if (e.key === 'Escape') { await sendKey('KEYCODE_BACK'); return; }
        if (e.key === 'h' || e.key === 'H') { await sendKey('KEYCODE_HOME'); return; }
        if (e.key === 'Tab') { e.preventDefault(); await sendKey('KEYCODE_APP_SWITCH'); return; }

        // Text input
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            await fetch(`${API_URL}/api/sessions/${sessionId}/input`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${localStorage.getItem('token') ?? ''}`,
                },
                body: JSON.stringify({ type: 'text', text: e.key }),
            }).catch(() => { });
        }
    };

    // ── Stream error / retry ──────────────────────────────────────────────────
    const handleStreamError = () => {
        setHasError(true);
    };

    const handleRetry = () => {
        setHasError(false);
        setStreamUrl(`${API_URL}/api/sessions/${sessionId}/stream?t=${Date.now()}`);
    };

    return (
        <div className="relative">
            <div
                ref={containerRef}
                className="relative mx-auto max-w-sm outline-none rounded-xl overflow-hidden shadow-2xl border border-border"
                tabIndex={0}
                onKeyDown={handleKeyDown}
                style={{ aspectRatio: `${screenWidth} / ${screenHeight}` }}
            >
                {hasError ? (
                    /* ── Error state with retry ─────────────────────────────── */
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-muted/80 text-muted-foreground">
                        <p className="text-sm">Stream unavailable</p>
                        <button
                            onClick={handleRetry}
                            className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-md hover:bg-primary/90 transition-colors"
                        >
                            Retry
                        </button>
                    </div>
                ) : (
                    <>
                        {streamUrl && (
                            <img
                                ref={imgRef}
                                src={streamUrl}
                                alt="Android Emulator Stream"
                                className="w-full h-full object-contain bg-black cursor-crosshair"
                                style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
                                onClick={handleClick}
                                onMouseDown={handleMouseDown}
                                onMouseUp={handleMouseUp}
                                onTouchStart={handleTouchStart}
                                onTouchEnd={handleTouchEnd}
                                onError={handleStreamError}
                                draggable={false}
                            />
                        )}

                        {/* Live badge */}
                        <div className="absolute top-2 right-2 px-2 py-1 bg-green-500/90 text-white text-xs rounded-md pointer-events-none">
                            Live MJPEG
                        </div>

                        {/* Resolution hint */}
                        <div className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-black/50 text-white/60 text-[10px] rounded pointer-events-none">
                            {screenWidth}×{screenHeight}
                        </div>
                    </>
                )}
            </div>

            <div className="mt-2 text-center text-xs text-muted-foreground">
                <p>Click to tap • Drag to swipe • R = reload • Esc = back • H = home</p>
            </div>
        </div>
    );
}
