import { create } from 'zustand';

interface Build {
    id: string;
    status: string;
    buildType: string;
    repoId: string;
    commit: string;
    commitMessage?: string;
    queuedAt: string;
    buildDuration?: number;
}

interface BuildStore {
    builds: Build[];
    currentBuild: Build | null;
    logs: string[];

    setBuilds: (builds: Build[]) => void;
    addBuild: (build: Build) => void;
    updateBuild: (buildId: string, updates: Partial<Build>) => void;
    setCurrentBuild: (build: Build | null) => void;
    addLog: (log: string) => void;
    clearLogs: () => void;
}

export const useBuildStore = create<BuildStore>((set, get) => ({
    builds: [],
    currentBuild: null,
    logs: [],

    setBuilds: (builds) => set({ builds }),

    addBuild: (build) => set({ builds: [build, ...get().builds] }),

    updateBuild: (buildId, updates) =>
        set({
            builds: get().builds.map((b) =>
                b.id === buildId ? { ...b, ...updates } : b
            ),
        }),

    setCurrentBuild: (build) => set({ currentBuild: build, logs: [] }),

    addLog: (log) => set({ logs: [...get().logs, log] }),

    clearLogs: () => set({ logs: [] }),
}));
