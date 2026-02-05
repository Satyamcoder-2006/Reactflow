'use client';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useState } from 'react';
import { Search, Plus, GitBranch } from 'lucide-react';

export default function ConnectRepoPage() {
    const [searchTerm, setSearchTerm] = useState('');

    // Mock GitHub repos - will be replaced with API
    const githubRepos = [
        { id: '1', fullName: 'username/my-react-native-app', description: 'My awesome RN app', isPrivate: false },
        { id: '2', fullName: 'username/mobile-app-v2', description: 'Production ready app', isPrivate: true },
        { id: '3', fullName: 'username/test-app', description: 'Testing purposes', isPrivate: false },
    ];

    const filteredRepos = githubRepos.filter((repo) =>
        repo.fullName.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleConnect = (repoId: string) => {
        console.log('Connecting repo:', repoId);
        // Will implement API call
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
                <div className="space-y-3">
                    {filteredRepos.map((repo) => (
                        <div
                            key={repo.id}
                            className="flex items-center justify-between p-4 rounded-lg border border-border bg-card hover:bg-accent transition-colors"
                        >
                            <div className="flex items-center gap-3">
                                <GitBranch className="h-5 w-5 text-muted-foreground" />
                                <div>
                                    <h3 className="font-medium">{repo.fullName}</h3>
                                    <p className="text-sm text-muted-foreground">{repo.description}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                {repo.isPrivate && (
                                    <span className="text-xs px-2 py-1 rounded-full bg-yellow-500/10 text-yellow-500">
                                        Private
                                    </span>
                                )}
                                <button
                                    onClick={() => handleConnect(repo.id)}
                                    className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                                >
                                    <Plus className="h-4 w-4" />
                                    Connect
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                {filteredRepos.length === 0 && (
                    <div className="text-center py-12 border border-dashed border-border rounded-lg">
                        <p className="text-muted-foreground">No repositories found</p>
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
