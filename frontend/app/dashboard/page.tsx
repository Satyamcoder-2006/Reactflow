'use client';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import Link from 'next/link';
import { GitBranch, Clock, CheckCircle2, XCircle, Plus, ExternalLink } from 'lucide-react';

export default function DashboardPage() {
    // Mock data - will be replaced with real API calls
    const repos = [
        {
            id: '1',
            name: 'my-react-native-app',
            fullName: 'username/my-react-native-app',
            lastBuild: {
                status: 'SUCCESS',
                time: '5 minutes ago',
                commit: 'abc123f',
            },
            shellCached: true,
        },
        {
            id: '2',
            name: 'mobile-app-v2',
            fullName: 'username/mobile-app-v2',
            lastBuild: {
                status: 'BUILDING',
                time: '2 minutes ago',
                commit: 'def456a',
            },
            shellCached: false,
        },
    ];

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'SUCCESS':
                return <CheckCircle2 className="h-5 w-5 text-green-500" />;
            case 'FAILED':
                return <XCircle className="h-5 w-5 text-red-500" />;
            case 'BUILDING':
                return <Clock className="h-5 w-5 text-yellow-500 animate-pulse" />;
            default:
                return <Clock className="h-5 w-5 text-muted-foreground" />;
        }
    };

    return (
        <DashboardLayout>
            <div className="max-w-6xl">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
                        <p className="text-muted-foreground">
                            Manage your React Native projects and builds
                        </p>
                    </div>
                    <Link
                        href="/repos/connect"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                    >
                        <Plus className="h-5 w-5" />
                        Connect Repository
                    </Link>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="p-6 rounded-lg border border-border bg-card">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm text-muted-foreground">Total Repositories</span>
                            <GitBranch className="h-5 w-5 text-primary" />
                        </div>
                        <p className="text-3xl font-bold">{repos.length}</p>
                    </div>

                    <div className="p-6 rounded-lg border border-border bg-card">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm text-muted-foreground">Builds Today</span>
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                        </div>
                        <p className="text-3xl font-bold">12</p>
                    </div>

                    <div className="p-6 rounded-lg border border-border bg-card">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm text-muted-foreground">Avg Build Time</span>
                            <Clock className="h-5 w-5 text-blue-500" />
                        </div>
                        <p className="text-3xl font-bold">2m 34s</p>
                    </div>
                </div>

                {/* Repositories List */}
                <div>
                    <h2 className="text-xl font-semibold mb-4">Your Repositories</h2>

                    {repos.length === 0 ? (
                        <div className="text-center py-12 border border-dashed border-border rounded-lg">
                            <GitBranch className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                            <h3 className="text-lg font-medium mb-2">No repositories connected</h3>
                            <p className="text-muted-foreground mb-4">
                                Connect your first GitHub repository to get started
                            </p>
                            <Link
                                href="/repos/connect"
                                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                            >
                                <Plus className="h-5 w-5" />
                                Connect Repository
                            </Link>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {repos.map((repo) => (
                                <Link
                                    key={repo.id}
                                    href={`/repos/${repo.id}`}
                                    className="block p-6 rounded-lg border border-border bg-card hover:bg-accent transition-colors"
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-2">
                                                <h3 className="text-lg font-semibold">{repo.name}</h3>
                                                {repo.shellCached && (
                                                    <span className="px-2 py-1 text-xs rounded-full bg-green-500/10 text-green-500">
                                                        Shell Cached
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-sm text-muted-foreground mb-3">{repo.fullName}</p>

                                            <div className="flex items-center gap-4 text-sm">
                                                <div className="flex items-center gap-2">
                                                    {getStatusIcon(repo.lastBuild.status)}
                                                    <span className="text-muted-foreground">
                                                        Last build: {repo.lastBuild.time}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono text-xs text-muted-foreground">
                                                        {repo.lastBuild.commit}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        <ExternalLink className="h-5 w-5 text-muted-foreground" />
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </DashboardLayout>
    );
}
