'use client';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Plus, GitBranch } from 'lucide-react';
import { apiClient } from '@/lib/api/client';

export default function ConnectRepoPage() {
    const [searchTerm, setSearchTerm] = useState('');
    const [githubRepos, setGithubRepos] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
        const fetchGithubRepos = async () => {
            try {
                const response = await apiClient.listGithubRepos();
                setGithubRepos(response.data.repos);
            } catch (error: any) {
                console.error('Failed to fetch GitHub repos:', error);
                if (error.response) {
                    console.error('Server error details:', error.response.data);
                    console.error('Status:', error.response.status);
                }
            } finally {
                setLoading(false);
            }
        };

        fetchGithubRepos();
    }, []);

    const filteredRepos = githubRepos.filter((repo) =>
        repo.full_name?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleConnect = async (repo: any) => {
        try {
            await apiClient.connectRepo({
                githubRepoId: String(repo.id),
                fullName: repo.full_name,
            });
            router.push('/dashboard');
        } catch (error) {
            console.error('Failed to connect repo:', error);
        }
    };

    return (
        <DashboardLayout>
            <div className="max-w-4xl">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold mb-2">Connect Repository</h1>
                    <p className="text-muted-foreground">
                        Select a GitHub repository to connect to ReactFlow
                    </p>
                </div>

                {/* Search */}
                <div className="relative mb-6">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search repositories..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-card border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                </div>

                {/* Repository List */}
                {loading ? (
                    <div className="flex justify-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {filteredRepos.map((repo) => (
                            <div
                                key={repo.id}
                                className="flex items-center justify-between p-4 rounded-lg border border-border bg-card hover:bg-accent transition-colors"
                            >
                                <div className="flex items-center gap-3">
                                    <GitBranch className="h-5 w-5 text-muted-foreground" />
                                    <div>
                                        <h3 className="font-medium">{repo.full_name}</h3>
                                        <p className="text-sm text-muted-foreground">{repo.description}</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    {repo.private && (
                                        <span className="text-xs px-2 py-1 rounded-full bg-yellow-500/10 text-yellow-500">
                                            Private
                                        </span>
                                    )}
                                    <button
                                        onClick={() => handleConnect(repo)}
                                        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                                    >
                                        <Plus className="h-4 w-4" />
                                        Connect
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {!loading && filteredRepos.length === 0 && (
                    <div className="text-center py-12 border border-dashed border-border rounded-lg">
                        <p className="text-muted-foreground">No repositories found</p>
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
