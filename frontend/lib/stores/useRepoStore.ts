import { create } from 'zustand';

interface Repo {
    id: string;
    name: string;
    fullName: string;
    defaultBranch: string;
    lastBuild?: any;
    shellCached?: boolean;
}

interface RepoStore {
    repos: Repo[];
    currentRepo: Repo | null;
    isLoading: boolean;

    setRepos: (repos: Repo[]) => void;
    addRepo: (repo: Repo) => void;
    removeRepo: (repoId: string) => void;
    setCurrentRepo: (repo: Repo | null) => void;
    fetchRepos: () => Promise<void>;
}

export const useRepoStore = create<RepoStore>((set, get) => ({
    repos: [],
    currentRepo: null,
    isLoading: false,

    setRepos: (repos) => set({ repos }),

    addRepo: (repo) => set({ repos: [...get().repos, repo] }),

    removeRepo: (repoId) =>
        set({ repos: get().repos.filter((r) => r.id !== repoId) }),

    setCurrentRepo: (repo) => set({ currentRepo: repo }),

    fetchRepos: async () => {
        set({ isLoading: true });
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
            const token = localStorage.getItem('token');

            const response = await fetch(`${apiUrl}/api/repos`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (response.ok) {
                const data = await response.json();
                set({ repos: data.repos, isLoading: false });
            } else {
                set({ isLoading: false });
            }
        } catch (error) {
            console.error('Failed to fetch repos:', error);
            set({ isLoading: false });
        }
    },
}));
