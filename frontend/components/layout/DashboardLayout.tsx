'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';
import {
    LayoutDashboard,
    FolderGit2,
    Package,
    LogOut,
    Zap,
    User
} from 'lucide-react';

interface DashboardLayoutProps {
    children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
    const pathname = usePathname();

    const navigation = [
        { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
        { name: 'Repositories', href: '/repos', icon: FolderGit2 },
        { name: 'Builds', href: '/builds', icon: Package },
    ];

    const isActive = (href: string) => pathname?.startsWith(href);

    return (
        <div className="min-h-screen bg-background">
            {/* Sidebar */}
            <aside className="fixed inset-y-0 left-0 w-64 bg-card border-r border-border">
                <div className="flex flex-col h-full">
                    {/* Logo */}
                    <div className="flex items-center gap-2 h-16 px-6 border-b border-border">
                        <Zap className="h-6 w-6 text-primary" />
                        <span className="text-xl font-bold">ReactFlow</span>
                    </div>

                    {/* Navigation */}
                    <nav className="flex-1 p-4 space-y-1">
                        {navigation.map((item) => (
                            <Link
                                key={item.name}
                                href={item.href}
                                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive(item.href)
                                        ? 'bg-primary text-primary-foreground'
                                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                                    }`}
                            >
                                <item.icon className="h-5 w-5" />
                                {item.name}
                            </Link>
                        ))}
                    </nav>

                    {/* User Profile */}
                    <div className="p-4 border-t border-border">
                        <div className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent cursor-pointer">
                            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                                <User className="h-4 w-4 text-primary-foreground" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">Developer</p>
                                <p className="text-xs text-muted-foreground truncate">Logged in</p>
                            </div>
                        </div>
                        <button className="w-full mt-2 flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors">
                            <LogOut className="h-4 w-4" />
                            Logout
                        </button>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <div className="pl-64">
                {/* Top Bar */}
                <header className="sticky top-0 z-10 h-16 bg-card/95 backdrop-blur border-b border-border">
                    <div className="flex items-center justify-between h-full px-8">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span className="text-foreground font-medium">ReactFlow</span>
                            <span>/</span>
                            <span>Dashboard</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="px-3 py-1 rounded-full bg-green-500/10 text-green-500 text-xs font-medium">
                                ● Online
                            </div>
                        </div>
                    </div>
                </header>

                {/* Page Content */}
                <main className="p-8">
                    {children}
                </main>
            </div>
        </div>
    );
}
