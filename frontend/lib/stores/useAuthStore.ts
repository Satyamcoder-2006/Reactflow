import { create } from 'zustand';

interface User {
    id: string;
    email: string;
    name: string;
    avatarUrl?: string;
    githubLogin: string;
}

interface AuthStore {
    user: User | null;
    token: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;

    setUser: (user: User) => void;
    setToken: (token: string) => void;
    logout: () => void;
    checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: true,

    setUser: (user) => set({ user, isAuthenticated: true }),

    setToken: (token) => {
        localStorage.setItem('token', token);
        set({ token });
    },

    logout: () => {
        localStorage.removeItem('token');
        set({ user: null, token: null, isAuthenticated: false });
    },

    checkAuth: async () => {
        const token = localStorage.getItem('token');
        if (!token) {
            set({ isLoading: false, isAuthenticated: false });
            return;
        }

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
            const response = await fetch(`${apiUrl}/api/auth/user`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (response.ok) {
                const data = await response.json();
                set({
                    user: data.user,
                    token,
                    isAuthenticated: true,
                    isLoading: false,
                });
            } else {
                localStorage.removeItem('token');
                set({ isLoading: false, isAuthenticated: false });
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            set({ isLoading: false, isAuthenticated: false });
        }
    },
}));
