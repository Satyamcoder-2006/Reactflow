'use client';

import { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useParams, useRouter } from 'next/navigation';
import { EmulatorViewer } from '@/components/preview/EmulatorViewer';
import { DeviceControls } from '@/components/preview/DeviceControls';
import { apiClient } from '@/lib/api/client';
import {
    Smartphone, RefreshCw, X, Info,
    Loader2, AlertCircle, Clock, WifiOff,
} from 'lucide-react';

// Keep in sync with backend SessionLifecycleStep enum
type LifecycleStep =
    | 'PENDING'
    | 'BOOTING'
    | 'INSTALLING_APK'
    | 'SETTING_UP_METRO'
    | 'LAUNCHING_APP'
    | 'STREAM_STARTING'
    | 'LIVE'
    | 'WAITING_FOR_BUILD'
    | 'ERROR';

interface Session {
    id: string;
    status: string;
    startedAt: string | null;
    repo: { name: string; fullName: string };
}

interface LifecycleEvent {
    sessionId: string;
    step: LifecycleStep;
    message?: string;
    timestamp: number;
}

const STEP_LABELS: Record<LifecycleStep, string> = {
    PENDING: 'Preparing...',
    BOOTING: 'Booting Android...',
    INSTALLING_APK: 'Installing app...',
    SETTING_UP_METRO: 'Connecting Metro bundler...',
    LAUNCHING_APP: 'Launching app...',
    STREAM_STARTING: 'Starting video stream...',
    LIVE: 'Live',
    WAITING_FOR_BUILD: 'Waiting for first build...',
    ERROR: 'Error',
};

const ORDERED_STEPS: LifecycleStep[] = [
    'PENDING', 'BOOTING', 'INSTALLING_APK',
    'SETTING_UP_METRO', 'LAUNCHING_APP', 'STREAM_STARTING', 'LIVE',
];

export default function PreviewPage() {
    const params = useParams();
    const router = useRouter();
    const sessionId = params.sessionId as string;

    const [session, setSession] = useState<Session | null>(null);
    const [lifecycleStep, setLifecycleStep] = useState<LifecycleStep>('PENDING');
    const [lifecycleMessage, setLifecycleMessage] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sessionDuration, setSessionDuration] = useState('0m 0s');

    // ── Fetch session data ──────────────────────────────────────────────────
    const fetchSession = useCallback(async () => {
        try {
            const res = await apiClient.getSession(sessionId);
            setSession(res.data.session);

            // Sync status → lifecycle step
            const status = res.data.session?.status as string;
            if (status === 'RUNNING') setLifecycleStep('LIVE');
            else if (status === 'ERROR') setLifecycleStep('ERROR');
            else if (status === 'STARTING') setLifecycleStep('BOOTING');
        } catch (err) {
            setError('Failed to load session.');
        } finally {
            setIsLoading(false);
        }
    }, [sessionId]);

    useEffect(() => {
        fetchSession();
    }, [fetchSession]);

    // ── WebSocket lifecycle subscription ────────────────────────────────────
    useEffect(() => {
        const wsUrl = (process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:3001')
            .replace(/^http/, 'ws');

        // This matches the existing Socket.io or ws setup in the backend
        let ws: WebSocket | null = null;

        try {
            ws = new WebSocket(`${wsUrl}/session-lifecycle`);

            ws.onmessage = (ev) => {
                try {
                    const event: LifecycleEvent = JSON.parse(ev.data as string);
                    if (event.sessionId !== sessionId) return;

                    setLifecycleStep(event.step);
                    if (event.message) setLifecycleMessage(event.message);

                    if (event.step === 'LIVE') {
                        fetchSession(); // Refresh session record
                    }
                } catch {
                    // Ignore parse errors
                }
            };

            ws.onerror = () => {
                // WebSocket unavailable — rely on polling instead
            };
        } catch {
            // WebSocket connection failed — will fall back to polling
        }

        // Polling fallback: re-fetch session every 5s until LIVE
        const poll = setInterval(() => {
            if (lifecycleStep !== 'LIVE' && lifecycleStep !== 'ERROR') {
                fetchSession();
            }
        }, 5_000);

        return () => {
            ws?.close();
            clearInterval(poll);
        };
    }, [sessionId, lifecycleStep, fetchSession]);

    // ── Session duration timer ───────────────────────────────────────────────
    useEffect(() => {
        if (!session?.startedAt) return;

        const startedAt = new Date(session.startedAt).getTime();
        const timer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startedAt) / 1_000);
            const minutes = Math.floor(elapsed / 60);
            const seconds = elapsed % 60;
            setSessionDuration(`${minutes}m ${seconds}s`);
        }, 1_000);

        return () => clearInterval(timer);
    }, [session?.startedAt]);

    // ── Actions ─────────────────────────────────────────────────────────────
    const handleReload = async () => {
        try {
            await apiClient.sendInput(sessionId, { type: 'key', key: 'KEYCODE_R' });
        } catch {
            // Ignore
        }
    };

    const handleStop = async () => {
        try {
            await apiClient.stopSession(sessionId);
            router.push('/dashboard');
        } catch {
            // Ignore
        }
    };

    // ── Lifecycle progress overlay ───────────────────────────────────────────
    const isLive = lifecycleStep === 'LIVE';
    const isError = lifecycleStep === 'ERROR';
    const isWaiting = lifecycleStep === 'WAITING_FOR_BUILD';

    const currentStepIndex = ORDERED_STEPS.indexOf(lifecycleStep);

    const statusColor =
        isLive ? 'bg-green-500' :
            isError ? 'bg-red-500' :
                'bg-amber-500 animate-pulse';

    const statusLabel =
        isLive ? 'Live' :
            isError ? 'Error' :
                'Starting...';

    if (isLoading) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center h-64">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            </DashboardLayout>
        );
    }

    if (error || !session) {
        return (
            <DashboardLayout>
                <div className="flex flex-col items-center justify-center h-64 gap-4">
                    <AlertCircle className="h-10 w-10 text-destructive" />
                    <p className="text-muted-foreground">{error ?? 'Session not found.'}</p>
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout>
            <div className="max-w-7xl">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold mb-1">Live Preview</h1>
                        <p className="text-muted-foreground">{session.repo?.fullName ?? session.repo?.name}</p>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleReload}
                            disabled={!isLive}
                            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-40"
                        >
                            <RefreshCw className="h-4 w-4" />
                            Reload
                        </button>
                        <button
                            onClick={handleStop}
                            className="flex items-center gap-2 px-4 py-2 border border-border text-destructive rounded-md hover:bg-destructive/10 transition-colors"
                        >
                            <X className="h-4 w-4" />
                            Stop Session
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Emulator View */}
                    <div className="lg:col-span-2">
                        <div className="rounded-lg border border-border bg-card p-6">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <Smartphone className="h-5 w-5 text-primary" />
                                    <span className="font-medium">Android Emulator</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${statusColor}`} />
                                    <span className="text-sm text-muted-foreground">{statusLabel}</span>
                                </div>
                            </div>

                            {/* Lifecycle progress (shown until LIVE) */}
                            {!isLive && !isError && !isWaiting && (
                                <div className="mb-4 rounded-lg bg-muted/30 p-4">
                                    <p className="text-sm font-medium mb-3 text-muted-foreground">Starting up...</p>
                                    <ol className="space-y-1.5">
                                        {ORDERED_STEPS.map((step, idx) => {
                                            const isDone = idx < currentStepIndex;
                                            const isCurrent = idx === currentStepIndex;
                                            return (
                                                <li key={step} className={`flex items-center gap-2 text-sm ${isCurrent ? 'text-primary font-semibold' : isDone ? 'text-green-500' : 'text-muted-foreground/50'}`}>
                                                    {isDone ? '✓' : isCurrent ? <Loader2 className="h-3 w-3 animate-spin inline" /> : '○'}
                                                    {STEP_LABELS[step]}
                                                </li>
                                            );
                                        })}
                                    </ol>
                                    {lifecycleMessage && (
                                        <p className="text-xs text-muted-foreground mt-2">{lifecycleMessage}</p>
                                    )}
                                </div>
                            )}

                            {/* Waiting for build */}
                            {isWaiting && (
                                <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
                                    <Clock className="h-10 w-10" />
                                    <p className="text-sm">Waiting for first build to complete...</p>
                                    <p className="text-xs">Trigger a build and the emulator will start automatically.</p>
                                </div>
                            )}

                            {/* Error state */}
                            {isError && (
                                <div className="flex flex-col items-center justify-center h-48 gap-3 text-destructive">
                                    <WifiOff className="h-10 w-10" />
                                    <p className="text-sm font-medium">Emulator failed to start</p>
                                    {lifecycleMessage && <p className="text-xs text-muted-foreground">{lifecycleMessage}</p>}
                                </div>
                            )}

                            {/* Live stream */}
                            {isLive && (
                                <EmulatorViewer
                                    sessionId={sessionId}
                                    screenWidth={412}
                                    screenHeight={892}
                                />
                            )}
                        </div>
                    </div>

                    {/* Controls & Info */}
                    <div className="space-y-6">
                        <div className="rounded-lg border border-border bg-card p-6">
                            <h3 className="font-medium mb-4">Device Controls</h3>
                            <DeviceControls sessionId={sessionId} disabled={!isLive} />
                        </div>

                        {/* Session Info */}
                        <div className="rounded-lg border border-border bg-card p-6">
                            <div className="flex items-center gap-2 mb-4">
                                <Info className="h-5 w-5 text-primary" />
                                <h3 className="font-medium">Session Info</h3>
                            </div>

                            <div className="space-y-3 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Status</span>
                                    <span className={`px-2 py-0.5 rounded-full text-xs ${isLive ? 'bg-green-500/10 text-green-500' : isError ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-500'}`}>
                                        {lifecycleStep}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Started</span>
                                    <span>{session.startedAt ? new Date(session.startedAt).toLocaleTimeString() : '—'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Duration</span>
                                    <span>{session.startedAt ? sessionDuration : '—'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Session ID</span>
                                    <span className="font-mono text-xs truncate max-w-24">{sessionId.substring(0, 8)}…</span>
                                </div>
                            </div>
                        </div>

                        {/* Tips */}
                        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
                            <h4 className="font-medium text-sm text-blue-400 mb-2">💡 Tips</h4>
                            <ul className="text-xs text-blue-300/80 space-y-1">
                                <li>• Click to tap on the screen</li>
                                <li>• Drag to swipe</li>
                                <li>• Press R to reload JS bundle</li>
                                <li>• Esc → Back button</li>
                                <li>• H → Home button</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}
