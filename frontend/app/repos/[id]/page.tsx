'use client';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useParams, useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BuildHistory } from '@/components/build/BuildHistory';
import { GitBranch, Package, Clock, ExternalLink, Play, Trash } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api/client';

export default function RepoDetailPage() {
    const params = useParams();
    const router = useRouter();
    const repoId = params.id as string;
    const [repo, setRepo] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [triggering, setTriggering] = useState(false);

    useEffect(() => {
        const fetchRepo = async () => {
            try {
                const response = await apiClient.getRepo(repoId);
                setRepo(response.data.repo);
            } catch (error) {
                console.error('Failed to fetch repo:', error);
            } finally {
                setLoading(false);
            }
        };

        if (repoId) {
            fetchRepo();
        }
    }, [repoId]);

    const handleTriggerBuild = async () => {
        setTriggering(true);
        try {
            await apiClient.triggerBuild(repoId);
            // Refresh repo data to show new build
            const response = await apiClient.getRepo(repoId);
            setRepo(response.data.repo);
        } catch (error) {
            console.error('Failed to trigger build:', error);
        } finally {
            setTriggering(false);
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
            <div className="max-w-6xl">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-start justify-between mb-4">
                        <div>
                            <h1 className="text-3xl font-bold mb-2">{repo.name}</h1>
                            <div className="flex items-center gap-3 text-muted-foreground">
                                <span>{repo.fullName}</span>
                                <span>•</span>
                                <span>{repo.isPrivate ? '🔒 Private' : '🌍 Public'}</span>
                                <span>•</span>
                                <div className="flex items-center gap-1">
                                    <GitBranch className="h-4 w-4" />
                                    <span>{repo.defaultBranch}</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleTriggerBuild}
                                disabled={triggering}
                                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
                            >
                                <Play className="h-4 w-4" />
                                {triggering ? 'Starting...' : 'Trigger Build'}
                            </button>
                            <button
                                onClick={handleDisconnect}
                                className="flex items-center gap-2 px-4 py-2 border border-border text-destructive rounded-md hover:bg-destructive/10 transition-colors"
                            >
                                <Trash className="h-4 w-4" />
                                Disconnect
                            </button>
                        </div>
                    </div>

                    {/* Stats Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="p-4 rounded-lg border border-border bg-card">
                            <div className="flex items-center gap-2 mb-1">
                                <Package className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">Shell Status</span>
                            </div>
                            <p className="text-xl font-semibold">
                                {currentShell ? '✓ Cached' : 'Using Default'}
                            </p>
                        </div>

                        <div className="p-4 rounded-lg border border-border bg-card">
                            <div className="flex items-center gap-2 mb-1">
                                <Clock className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">Last Build</span>
                            </div>
                            <p className="text-xl font-semibold">
                                {lastBuild?.duration ? `${Math.floor(lastBuild.duration / 60)}m` : '-'}
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
                                <span className="text-sm text-muted-foreground">React Native</span>
                            </div>
                            <p className="text-xl font-semibold">
                                {repo.packageJson?.dependencies?.['react-native'] || '-'}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <Tabs defaultValue="builds" className="w-full">
                    <TabsList className="mb-6">
                        <TabsTrigger value="builds">Builds</TabsTrigger>
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="settings">Settings</TabsTrigger>
                    </TabsList>

                    <TabsContent value="builds">
                        <BuildHistory builds={repo.builds || []} />
                    </TabsContent>

                    <TabsContent value="overview">
                        <div className="p-6 rounded-lg border border-border bg-card">
                            <h3 className="font-semibold mb-4">Repository Information</h3>
                            <div className="space-y-3 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Default Branch</span>
                                    <span className="font-mono">{repo.defaultBranch}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Last Commit</span>
                                    <span className="font-mono">{lastBuild?.commit?.substring(0, 7) || '-'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Shell Cache</span>
                                    <span>{currentShell ? 'Active' : 'None'}</span>
                                </div>
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="settings">
                        <div className="p-6 rounded-lg border border-border bg-card">
                            <h3 className="font-semibold text-destructive mb-4">Danger Zone</h3>
                            <p className="text-sm text-muted-foreground mb-4">
                                Disconnecting this repository will stop all builds and delete webhooks.
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
        </DashboardLayout>
    );
}
