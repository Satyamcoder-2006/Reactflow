'use client';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { BuildHistory } from '@/components/build/BuildHistory';
import { Package } from 'lucide-react';

export default function BuildsPage() {
    // Mock builds - will be replaced with API
    const builds = [
        {
            id: '1',
            repoId: '1',
            status: 'SUCCESS',
            buildType: 'SHELL',
            queuedAt: new Date().toISOString(),
            buildDuration: 720,
            commit: 'abc123f',
            commitMessage: 'Add new feature',
        },
        {
            id: '2',
            repoId: '1',
            status: 'FAILED',
            buildType: 'HOT_RELOAD',
            queuedAt: new Date().toISOString(),
            buildDuration: 45,
            commit: 'def456a',
            commitMessage: 'Fix bug',
        },
    ];

    return (
        <DashboardLayout>
            <div className="max-w-6xl">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                        <Package className="h-8 w-8 text-primary" />
                        <h1 className="text-3xl font-bold">Builds</h1>
                    </div>
                    <p className="text-muted-foreground">
                        View all builds across your repositories
                    </p>
                </div>

                {/* Build History */}
                <BuildHistory builds={builds} />
            </div>
        </DashboardLayout>
    );
}
