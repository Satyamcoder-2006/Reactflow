import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export const api = axios.create({
    baseURL: `${API_URL}/api`,
    withCredentials: true,
});

// Add auth token to requests
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// API methods
export const apiClient = {
    // Auth
    login: (code: string) => api.post('/auth/github', { code }),
    getUser: () => api.get('/auth/user'),
    logout: () => api.post('/auth/logout'),

    // Repositories
    listRepos: () => api.get('/repos'),
    listGithubRepos: () => api.get('/repos/github'),
    connectRepo: (data: { githubRepoId: string; fullName: string }) =>
        api.post('/repos', data),
    getRepo: (id: string) => api.get(`/repos/${id}`),
    disconnectRepo: (id: string) => api.delete(`/repos/${id}`),

    // Builds
    listBuilds: (repoId: string) => api.get(`/builds/repo/${repoId}`),
    triggerBuild: (repoId: string, data: { branch?: string; buildType?: string } = {}) =>
        api.post(`/builds/repo/${repoId}/build`, data),
    getBuild: (id: string) => api.get(`/builds/${id}`),
    getBuildLogs: (id: string) => api.get(`/builds/${id}/logs`),
    cancelBuild: (id: string) => api.delete(`/builds/${id}`),

    // Sessions
    listSessions: () => api.get('/sessions'),
    createSession: (data: { repoId: string; shellId?: string; emulatorConfig?: any }) =>
        api.post('/sessions', data),
    getSession: (id: string) => api.get(`/sessions/${id}`),
    stopSession: (id: string) => api.delete(`/sessions/${id}`),
    sendInput: (id: string, input: any) => api.post(`/sessions/${id}/input`, input),

    // WebRTC
    sendSignal: (data: { sessionId: string; type: string; data: any }) =>
        api.post('/webrtc/signal', data),
    getIceServers: () => api.get('/webrtc/ice-servers'),
};
