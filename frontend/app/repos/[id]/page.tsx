'use client';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useParams, useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BuildHistory } from '@/components/build/BuildHistory';
import { BuildLogs } from '@/components/build/BuildLogs'; // Import BuildLogs
import { EmulatorViewer } from '@/components/preview/EmulatorViewer'; // Import EmulatorViewer
import { GitBranch, Package, Clock, Play, Trash, Smartphone, Terminal, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api/client';
import { getSocket } from '@/lib/utils/socket';

export default function RepoDetailPage() {
    const params = useParams();
    const router = useRouter();
    const repoId = params.id as string;
    const [repo, setRepo] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [triggering, setTriggering] = useState(false);
    const [activeBuildId, setActiveBuildId] = useState<string | null>(null);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [startingSession, setStartingSession] = useState(false);
    const [autoStartSession, setAutoStartSession] = useState(false);

    const fetchRepo = async () => {
        try {
            const response = await apiClient.getRepo(repoId);
            setRepo(response.data.repo);
            // Check if there's a running build
            const runningBuild = response.data.repo.builds?.find(
                (b: any) => b.status === 'QUEUED' || b.status === 'BUILDING'
            );
            if (runningBuild) {
                setActiveBuildId(runningBuild.id);
            }
        } catch (error) {
            console.error('Failed to fetch repo:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (repoId) {
            fetchRepo();

            // Listen for events to update repo data
            const socket = getSocket();

            const handleBuildEvent = (event: any) => {
                if (event.repoId !== repoId) return;

                if (event.type === 'build:started') {
                    setActiveBuildId(event.buildId);
                    fetchRepo();
                } else if (event.type === 'build:complete' || event.type === 'build:failed') {
                    fetchRepo();
                }
            };

            const handleSessionEvent = (event: any) => {
                if (event.type === 'session:status' && event.sessionId) {
                    setSessionId(event.sessionId);
                }
            };

            socket.on('build:event', handleBuildEvent);
            socket.on('session:event', handleSessionEvent);

            // Backward compatibility listeners
            socket.on('build:started', ({ buildId }) => {
                setActiveBuildId(buildId);
                fetchRepo();
            });
            socket.on('build:complete', () => {
                fetchRepo();
            });
        }
        return () => {
            const socket = getSocket();
            socket.off('build:event');
            socket.off('session:event');
            socket.off('build:started');
            socket.off('build:complete');
        };
    }, [repoId]);

    const handleTriggerBuild = async () => {
        setTriggering(true);
        try {
            const res = await apiClient.triggerBuild(repoId, {
                autoStartSession
            } as any);
            setActiveBuildId(res.data.build.id);
            fetchRepo();
        } catch (error) {
            console.error('Failed to trigger build:', error);
        } finally {
            setTriggering(false);
        }
    };

    const handleStartSession = async () => {
        if (!repo.shells?.some((s: any) => s.isCurrent)) {
            alert('No shell APK available. Please build the project first.');
            return;
        }

        setStartingSession(true);
        try {
            const currentShell = repo.shells.find((s: any) => s.isCurrent);
            const res = await apiClient.createSession({
                repoId,
                shellId: currentShell.shellId,
            });
            setSessionId(res.data.session.id);
        } catch (error) {
            console.error('Failed to start session:', error);
            alert('Failed to start emulator session');
        } finally {
            setStartingSession(false);
        }
    };

    const handleStopSession = async () => {
        if (!sessionId) return;
        try {
            await apiClient.stopSession(sessionId);
            setSessionId(null);
        } catch (error) {
            console.error('Failed to stop session:', error);
        }
    };

    const handleDisconnect = async () => {
        if (!confirm('Are you sure you want to disconnect this repository?')) return;

        try {
            await apiClient.disconnectRepo(repoId);
            router.push('/dashboard');
        } catch (error) {
            console.error('Failed to disconnect repo:', error);
        }
    };

    if (loading) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
            </DashboardLayout>
        );
    }

    if (!repo) {
        return (
            <DashboardLayout>
                <div className="text-center py-12">
                    <h2 className="text-xl font-semibold mb-2">Repository not found</h2>
                    <p className="text-muted-foreground">The requested repository does not exist.</p>
                </div>
            </DashboardLayout>
        );
    }

    const lastBuild = repo.builds?.[0];
    const currentShell = repo.shells?.find((s: any) => s.isCurrent)?.shell;

    return (
        <DashboardLayout>
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
                        <div>
                            <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
                                {repo.name}
                                {sessionId && (
                                    <span className="px-2 py-0.5 text-xs bg-green-500/10 text-green-500 rounded-full border border-green-500/20">
                                        Session Active
                                    </span>
                                )}
                            </h1>
                            <div className="flex flex-wrap items-center gap-3 text-muted-foreground text-sm">
                                <span>{repo.fullName}</span>
                                <span>•</span>
                                <div className="flex items-center gap-1">
                                    <GitBranch className="h-3 w-3" />
                                    <span>{repo.defaultBranch}</span>
                                </div>
                                <span>•</span>
                                <span>{repo.isPrivate ? '🔒 Private' : '🌍 Public'}</span>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            {sessionId ? (
                                <button
                                    onClick={handleStopSession}
                                    className="flex items-center gap-2 px-4 py-2 bg-destructive/10 text-destructive border border-destructive/20 rounded-md hover:bg-destructive/20 transition-colors"
                                >
                                    <Smartphone className="h-4 w-4" />
                                    Stop Session
                                </button>
                            ) : (
                                <button
                                    onClick={handleStartSession}
                                    disabled={startingSession || !currentShell}
                                    className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground border border-border rounded-md hover:bg-secondary/80 transition-colors disabled:opacity-50"
                                >
                                    <Smartphone className="h-4 w-4" />
                                    {startingSession ? 'Starting...' : 'Preview App'}
                                </button>
                            )}

                            <div className="flex items-center gap-2 mr-2">
                                <input
                                    type="checkbox"
                                    id="autoStart"
                                    checked={autoStartSession}
                                    onChange={(e) => setAutoStartSession(e.target.checked)}
                                    className="w-4 h-4 rounded border-border bg-secondary text-primary focus:ring-primary"
                                />
                                <label htmlFor="autoStart" className="text-sm cursor-pointer select-none">
                                    Auto-start emulator
                                </label>
                            </div>

                            <button
                                onClick={handleTriggerBuild}
                                disabled={triggering}
                                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
                            >
                                <Play className="h-4 w-4" />
                                {triggering ? 'Queuing...' : 'Build Shell'}
                            </button>

                            <button
                                onClick={() => fetchRepo()}
                                className="p-2 border border-border rounded-md hover:bg-secondary transition-colors"
                                title="Refresh"
                            >
                                <RefreshCw className="h-4 w-4" />
                            </button>

                            <button
                                onClick={handleDisconnect}
                                className="p-2 text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                                title="Disconnect Repository"
                            >
                                <Trash className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    {/* Stats Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-4 rounded-lg border border-border bg-card">
                            <div className="flex items-center gap-2 mb-1">
                                <Package className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">Shell Status</span>
                            </div>
                            <p className="text-xl font-semibold">
                                {currentShell ? '✓ Cached' : 'No Shell'}
                            </p>
                        </div>

                        <div className="p-4 rounded-lg border border-border bg-card">
                            <div className="flex items-center gap-2 mb-1">
                                <Clock className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">Last Build</span>
                            </div>
                            <p className="text-xl font-semibold">
                                {lastBuild?.buildDuration ? `${Math.ceil(lastBuild.buildDuration)}s` : '-'}
                            </p>
                        </div>

                        <div className="p-4 rounded-lg border border-border bg-card">
                            <div className="flex items-center gap-2 mb-1">
                                <Package className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">APK Size</span>
                            </div>
                            <p className="text-xl font-semibold">
                                {currentShell?.apkSize ? `${(currentShell.apkSize / 1024 / 1024).toFixed(1)}MB` : '-'}
                            </p>
                        </div>

                        <div className="p-4 rounded-lg border border-border bg-card">
                            <div className="flex items-center gap-2 mb-1">
                                <GitBranch className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">RN Version</span>
                            </div>
                            <p className="text-xl font-semibold">
                                {repo.packageJson?.dependencies?.['react-native'] || '-'}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Left Column: Build Info / Logs / Tabs */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Active Build Logs (if any) */}
                        {activeBuildId && (
                            <div className="border border-border rounded-lg overflow-hidden">
                                <div className="bg-secondary/50 px-4 py-3 border-b border-border flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                        <Terminal className="h-4 w-4 text-primary" />
                                        <span className="font-medium text-sm">Build Progress</span>
                                    </div>
                                    <button
                                        onClick={() => setActiveBuildId(null)}
                                        className="text-xs text-muted-foreground hover:text-primary"
                                    >
                                        Hide
                                    </button>
                                </div>
                                <BuildLogs buildId={activeBuildId} />
                            </div>
                        )}

                        <Tabs defaultValue={sessionId ? "preview" : "builds"} className="w-full">
                            <TabsList className="mb-4">
                                <TabsTrigger value="builds">Build History</TabsTrigger>
                                <TabsTrigger value="preview" disabled={!sessionId && !currentShell}>
                                    App Preview
                                </TabsTrigger>
                                <TabsTrigger value="overview">Overview</TabsTrigger>
                                <TabsTrigger value="settings">Settings</TabsTrigger>
                            </TabsList>

                            <TabsContent value="builds">
                                <BuildHistory builds={repo.builds || []} />
                            </TabsContent>

                            <TabsContent value="preview">
                                {sessionId ? (
                                    <div className="flex justify-center bg-black/5 rounded-lg border border-border p-8">
                                        <EmulatorViewer sessionId={sessionId} />
                                    </div>
                                ) : (
                                    <div className="text-center py-12 border border-border border-dashed rounded-lg">
                                        <Smartphone className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                                        <h3 className="text-lg font-medium mb-1">No Active Session</h3>
                                        <p className="text-sm text-muted-foreground mb-4">
                                            Start a session to preview your app and test hot reloading.
                                        </p>
                                        <button
                                            onClick={handleStartSession}
                                            disabled={startingSession || !currentShell}
                                            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
                                        >
                                            {startingSession ? 'Starting...' : 'Launch Preview'}
                                        </button>
                                    </div>
                                )}
                            </TabsContent>

                            <TabsContent value="overview">
                                <div className="p-6 rounded-lg border border-border bg-card">
                                    <h3 className="font-semibold mb-4">Repository Details</h3>
                                    <div className="space-y-3 text-sm">
                                        <div className="flex justify-between py-2 border-b border-border/50">
                                            <span className="text-muted-foreground">Default Branch</span>
                                            <span className="font-mono">{repo.defaultBranch}</span>
                                        </div>
                                        <div className="flex justify-between py-2 border-b border-border/50">
                                            <span className="text-muted-foreground">Last Commit</span>
                                            <span className="font-mono">{lastBuild?.commit?.substring(0, 7) || '-'}</span>
                                        </div>
                                        <div className="flex justify-between py-2 border-b border-border/50">
                                            <span className="text-muted-foreground">Shell Cache</span>
                                            <span>{currentShell ? 'Active' : 'None'}</span>
                                        </div>
                                        <div className="flex justify-between py-2 border-b border-border/50">
                                            <span className="text-muted-foreground">Created At</span>
                                            <span>{new Date(repo.createdAt).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                </div>
                            </TabsContent>

                            <TabsContent value="settings">
                                <div className="p-6 rounded-lg border border-border bg-card">
                                    <h3 className="font-semibold text-destructive mb-4">Danger Zone</h3>
                                    <p className="text-sm text-muted-foreground mb-4">
                                        Disconnecting this repository will stop all builds, delete webhooks, and remove all associated data.
                                    </p>
                                    <button
                                        onClick={handleDisconnect}
                                        className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors"
                                    >
                                        Disconnect Repository
                                    </button>
                                </div>
                            </TabsContent>
                        </Tabs>
                    </div>

                    {/* Right Column: Active Session / Quick Actions */}
                    <div className="space-y-6">
                        {sessionId && (
                            <div className="rounded-lg border border-border bg-card p-4">
                                <h3 className="font-medium mb-2 flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                    Active Session
                                </h3>
                                <p className="text-xs text-muted-foreground mb-4">
                                    Session ID: {sessionId.substring(0, 8)}...
                                </p>
                                <div className="space-y-2">
                                    <button
                                        onClick={handleStopSession}
                                        className="w-full px-3 py-2 text-sm bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
                                    >
                                        Stop Session
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="rounded-lg border border-border bg-card p-4">
                            <h3 className="font-medium mb-3">Quick Actions</h3>
                            <div className="space-y-2">
                                <button
                                    onClick={handleTriggerBuild}
                                    disabled={triggering}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-md hover:bg-secondary transition-colors disabled:opacity-50"
                                >
                                    <Play className="h-3 w-3" />
                                    Trigger Shell Build
                                </button>
                                <button
                                    disabled
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-md hover:bg-secondary transition-colors opacity-50 cursor-not-allowed"
                                >
                                    <Terminal className="h-3 w-3" />
                                    View Metro Logs
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}
