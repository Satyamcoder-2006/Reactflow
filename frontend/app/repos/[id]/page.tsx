'use client';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BuildHistory } from '@/components/build/BuildHistory';
import { GitBranch, Package, Clock, ExternalLink, Play, Trash } from 'lucide-react';

export default function RepoDetailPage() {
    const params = useParams();
    const repoId = params.id as string;

    // Mock data - will be replaced with API calls
    const repo = {
        id: repoId,
        name: 'my-react-native-app',
        fullName: 'username/my-react-native-app',
        defaultBranch: 'main',
        isPrivate: false,
        lastBuild: {
            status: 'SUCCESS',
            time: '5 minutes ago',
            commit: 'abc123f',
        },
        shell: {
            cached: true,
            buildTime: 720,
            apkSize: 45000000,
            reactNativeVersion: '0.73.0',
        },
    };

    const builds = [
        {
            id: '1',
            status: 'SUCCESS',
            buildType: 'SHELL',
            queuedAt: new Date().toISOString(),
            buildDuration: 720,
            commit: 'abc123f',
            commitMessage: 'Add new feature',
        },
    ];

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
                            <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
                                <Play className="h-4 w-4" />
                                Trigger Build
                            </button>
                            <button className="flex items-center gap-2 px-4 py-2 border border-border text-destructive rounded-md hover:bg-destructive/10 transition-colors">
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
                                {repo.shell.cached ? '✓ Cached' : '⏳ Building'}
                            </p>
                        </div>

                        <div className="p-4 rounded-lg border border-border bg-card">
                            <div className="flex items-center gap-2 mb-1">
                                <Clock className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">Last Build</span>
                            </div>
                            <p className="text-xl font-semibold">{Math.floor(repo.shell.buildTime / 60)}m</p>
                        </div>

                        <div className="p-4 rounded-lg border border-border bg-card">
                            <div className="flex items-center gap-2 mb-1">
                                <Package className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">APK Size</span>
                            </div>
                            <p className="text-xl font-semibold">
                                {(repo.shell.apkSize / 1024 / 1024).toFixed(1)}MB
                            </p>
                        </div>

                        <div className="p-4 rounded-lg border border-border bg-card">
                            <div className="flex items-center gap-2 mb-1">
                                <GitBranch className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">React Native</span>
                            </div>
                            <p className="text-xl font-semibold">{repo.shell.reactNativeVersion}</p>
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
                        <BuildHistory builds={builds} />
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
                                    <span className="font-mono">{repo.lastBuild.commit}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Shell Cache</span>
                                    <span>{repo.shell.cached ? 'Active' : 'None'}</span>
                                </div>
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="settings">
                        <div className="p-6 rounded-lg border border-border bg-card">
                            <h3 className="font-semibold mb-4">Danger Zone</h3>
                            <p className="text-sm text-muted-foreground mb-4">
                                Disconnecting this repository will stop all builds and delete webhooks.
                            </p>
                            <button className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors">
                                Disconnect Repository
                            </button>
                        </div>
                    </TabsContent>
                </Tabs>
            </div>
        </DashboardLayout>
    );
}
