import { create } from 'zustand';

interface Session {
    id: string;
    repoId: string;
    status: string;
    startedAt: Date;
}

interface SessionStore {
    sessions: Session[];
    currentSession: Session | null;
    isConnected: boolean;

    setSessions: (sessions: Session[]) => void;
    addSession: (session: Session) => void;
    removeSession: (sessionId: string) => void;
    setCurrentSession: (session: Session | null) => void;
    setConnected: (connected: boolean) => void;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
    sessions: [],
    currentSession: null,
    isConnected: false,

    setSessions: (sessions) => set({ sessions }),

    addSession: (session) => set({ sessions: [...get().sessions, session] }),

    removeSession: (sessionId) =>
        set({ sessions: get().sessions.filter((s) => s.id !== sessionId) }),

    setCurrentSession: (session) => set({ currentSession: session }),

    setConnected: (connected) => set({ isConnected: connected }),
}));
