'use client';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useParams } from 'next/navigation';
import { EmulatorViewer } from '@/components/preview/EmulatorViewer';
import { DeviceControls } from '@/components/preview/DeviceControls';
import { Smartphone, RefreshCw, X, Info } from 'lucide-react';

export default function PreviewPage() {
    const params = useParams();
    const sessionId = params.sessionId as string;

    const session = {
        id: sessionId,
        repo: 'my-react-native-app',
        status: 'RUNNING',
        startedAt: new Date(),
    };

    const handleReload = () => {
        console.log('Reload triggered');
    };

    const handleStop = () => {
        console.log('Session stopped');
    };

    return (
        <DashboardLayout>
            <div className="max-w-7xl">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold mb-1">Live Preview</h1>
                        <p className="text-muted-foreground">{session.repo}</p>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleReload}
                            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
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
                                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                                    <span className="text-sm text-muted-foreground">Live</span>
                                </div>
                            </div>

                            <EmulatorViewer sessionId={sessionId} />
                        </div>
                    </div>

                    {/* Controls & Info */}
                    <div className="space-y-6">
                        {/* Device Controls */}
                        <div className="rounded-lg border border-border bg-card p-6">
                            <h3 className="font-medium mb-4">Device Controls</h3>
                            <DeviceControls sessionId={sessionId} />
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
                                    <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 text-xs">
                                        {session.status}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Started</span>
                                    <span>{new Date(session.startedAt).toLocaleTimeString()}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Duration</span>
                                    <span>5m 23s</span>
                                </div>
                            </div>
                        </div>

                        {/* Tips */}
                        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
                            <h4 className="font-medium text-sm text-blue-400 mb-2">💡 Tips</h4>
                            <ul className="text-xs text-blue-300/80 space-y-1">
                                <li>• Click to tap on the screen</li>
                                <li>• Use device controls for navigation</li>
                                <li>• Reload to see latest changes</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}
