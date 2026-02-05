import Link from 'next/link';
import { Github, ArrowRight } from 'lucide-react';

export default function LoginPage() {
    const handleGitHubLogin = () => {
        // Redirect to GitHub OAuth
        const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
        const redirectUri = `${process.env.NEXT_PUBLIC_FRONTEND_URL}/api/auth/callback`;
        const scope = 'repo,read:user,user:email';

        window.location.href = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}`;
    };

    return (
        <div className="min-h-screen bg-gradient-to-b from-background to-secondary flex items-center justify-center p-4">
            <div className="max-w-md w-full">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center gap-2 mb-4">
                        <div className="w-12 h-12 rounded-lg bg-primary flex items-center justify-center">
                            <span className="text-2xl">⚡</span>
                        </div>
                    </div>
                    <h1 className="text-3xl font-bold mb-2">Welcome to ReactFlow</h1>
                    <p className="text-muted-foreground">
                        Build and preview React Native apps in the cloud
                    </p>
                </div>

                {/* Login Card */}
                <div className="p-8 rounded-lg border border-border bg-card shadow-xl">
                    <h2 className="text-xl font-semibold mb-6 text-center">Sign in to continue</h2>

                    <button
                        onClick={handleGitHubLogin}
                        className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-[#24292e] hover:bg-[#1a1e22] text-white rounded-md transition-colors font-medium"
                    >
                        <Github className="h-5 w-5" />
                        Continue with GitHub
                        <ArrowRight className="h-5 w-5 ml-auto" />
                    </button>

                    <div className="mt-6 pt-6 border-t border-border">
                        <p className="text-sm text-muted-foreground text-center">
                            By signing in, you agree to our Terms of Service and Privacy Policy
                        </p>
                    </div>
                </div>

                {/* Features */}
                <div className="mt-8 grid grid-cols-3 gap-4 text-center">
                    <div>
                        <div className="text-2xl mb-1">⚡</div>
                        <p className="text-xs text-muted-foreground">15s feedback</p>
                    </div>
                    <div>
                        <div className="text-2xl mb-1">☁️</div>
                        <p className="text-xs text-muted-foreground">Cloud builds</p>
                    </div>
                    <div>
                        <div className="text-2xl mb-1">📱</div>
                        <p className="text-xs text-muted-foreground">Live preview</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
