'use client';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import Link from 'next/link';
import { GitBranch, Plus, ExternalLink, Clock, FolderGit2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api/client';

export default function ReposPage() {
    const [repos, setRepos] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchRepos = async () => {
            try {
                const response = await apiClient.listRepos();
                setRepos(response.data.repos);
            } catch (error) {
                console.error('Failed to fetch repos:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchRepos();
    }, []);

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'SUCCESS':
                return <div className="h-2 w-2 rounded-full bg-green-500" />;
            case 'FAILED':
                return <div className="h-2 w-2 rounded-full bg-red-500" />;
            case 'BUILDING':
                return <div className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />;
            default:
                return <div className="h-2 w-2 rounded-full bg-zinc-500" />;
        }
    };

    return (
        <DashboardLayout>
            <div className="max-w-6xl">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold mb-2">Repositories</h1>
                        <p className="text-muted-foreground">
                            Manage and build your connected projects
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

                {/* Loading State */}
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    </div>
                ) : (
                    <div>
                        {repos.length === 0 ? (
                            <div className="text-center py-16 border border-dashed border-border rounded-lg bg-card/50">
                                <FolderGit2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                                <h3 className="text-lg font-medium mb-2">No repositories connected</h3>
                                <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                                    Connect a GitHub repository to start building your React Native app in the cloud.
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
                            <div className="grid gap-4">
                                {repos.map((repo) => (
                                    <Link
                                        key={repo.id}
                                        href={`/repos/${repo.id}`}
                                        className="block p-6 rounded-lg border border-border bg-card hover:bg-accent/50 transition-all hover:border-primary/50 group"
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-3 mb-2">
                                                    <GitBranch className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                                                    <h3 className="text-lg font-semibold">{repo.name}</h3>
                                                    {repo.isPrivate && (
                                                        <span className="px-2 py-0.5 text-xs rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
                                                            Private
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-sm text-muted-foreground mb-4 pl-8">
                                                    {repo.fullName}
                                                </p>

                                                <div className="flex items-center gap-6 pl-8 text-sm text-muted-foreground">
                                                    <div className="flex items-center gap-2">
                                                        {getStatusIcon(repo.builds?.[0]?.status)}
                                                        <span>
                                                            {repo.builds?.[0]?.status || 'No builds'}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Clock className="h-4 w-4" />
                                                        <span>
                                                            {repo.builds?.[0]?.queuedAt
                                                                ? new Date(repo.builds[0].queuedAt).toLocaleDateString()
                                                                : 'Never'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            <ExternalLink className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
