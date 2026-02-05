import Link from 'next/link';
import { Github, Zap, Cloud, Smartphone, ArrowRight } from 'lucide-react';

export default function HomePage() {
    return (
        <div className="min-h-screen bg-gradient-to-b from-background to-secondary">
            {/* Navbar */}
            <nav className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="container flex h-16 items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Zap className="h-6 w-6 text-primary" />
                        <span className="text-xl font-bold">ReactFlow</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <Link
                            href="/login"
                            className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                            Get Started
                        </Link>
                    </div>
                </div>
            </nav>

            {/* Hero Section */}
            <div className="container py-24 lg:py-32">
                <div className="mx-auto max-w-4xl text-center">
                    <div className="inline-block rounded-lg bg-muted px-3 py-1 text-sm mb-6">
                        ⚡ 15-second feedback loops for React Native
                    </div>
                    <h1 className="text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl mb-6">
                        Build React Native Apps{' '}
                        <span className="text-primary">in the Cloud</span>
                    </h1>
                    <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
                        Connect your GitHub repo, get instant Android builds, and preview in your browser.
                        No more 10-minute rebuilds. Just pure productivity.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <Link
                            href="/login"
                            className="inline-flex items-center gap-2 px-6 py-3 text-lg rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                            <Github className="h-5 w-5" />
                            Sign in with GitHub
                            <ArrowRight className="h-5 w-5" />
                        </Link>
                    </div>
                </div>

                {/* Features Grid */}
                <div className="grid md:grid-cols-3 gap-8 mt-24 max-w-5xl mx-auto">
                    <div className="p-6 rounded-lg border border-border bg-card">
                        <Cloud className="h-12 w-12 text-primary mb-4" />
                        <h3 className="text-xl font-semibold mb-2">Cloud Builds</h3>
                        <p className="text-muted-foreground">
                            Automatic APK builds in the cloud. No Android Studio required.
                        </p>
                    </div>
                    <div className="p-6 rounded-lg border border-border bg-card">
                        <Smartphone className="h-12 w-12 text-primary mb-4" />
                        <h3 className="text-xl font-semibold mb-2">Browser Preview</h3>
                        <p className="text-muted-foreground">
                            Test your app in a real Android emulator, right in your browser.
                        </p>
                    </div>
                    <div className="p-6 rounded-lg border border-border bg-card">
                        <Zap className="h-12 w-12 text-primary mb-4" />
                        <h3 className="text-xl font-semibold mb-2">Instant Hot Reload</h3>
                        <p className="text-muted-foreground">
                            JS-only changes update in 15 seconds. Native changes rebuild automatically.
                        </p>
                    </div>
                </div>

                {/* How It Works */}
                <div className="mt-24 max-w-3xl mx-auto">
                    <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>
                    <div className="space-y-6">
                        <div className="flex gap-4">
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                                1
                            </div>
                            <div>
                                <h4 className="font-semibold mb-1">Connect Your Repo</h4>
                                <p className="text-muted-foreground">
                                    Authenticate with GitHub and select your React Native repository.
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-4">
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                                2
                            </div>
                            <div>
                                <h4 className="font-semibold mb-1">First Build</h4>
                                <p className="text-muted-foreground">
                                    We build your APK and cache the native dependencies (8-12 minutes, one time).
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-4">
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                                3
                            </div>
                            <div>
                                <h4 className="font-semibold mb-1">Iterate Fast</h4>
                                <p className="text-muted-foreground">
                                    Push code changes. JS updates in 15s. Native dependencies trigger a rebuild.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <footer className="border-t border-border mt-24 py-12">
                <div className="container text-center text-muted-foreground">
                    <p>Built for React Native developers who value their time.</p>
                </div>
            </footer>
        </div>
    );
}
