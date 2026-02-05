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
    connectRepo: (data: { githubRepoId: string; fullName: string }) =>
        api.post('/repos', data),
    getRepo: (id: string) => api.get(`/repos/${id}`),
    disconnectRepo: (id: string) => api.delete(`/repos/${id}`),

    // Builds
    listBuilds: (repoId: string) => api.get(`/builds/${repoId}`),
    triggerBuild: (repoId: string) => api.post(`/builds/${repoId}`),
    getBuild: (id: string) => api.get(`/builds/${id}`),
    getBuildLogs: (id: string) => api.get(`/builds/${id}/logs`),

    // Sessions
    createSession: (data: { repoId: string; shellId: string }) =>
        api.post('/sessions', data),
    getSession: (id: string) => api.get(`/sessions/${id}`),
    stopSession: (id: string) => api.delete(`/sessions/${id}`),
    sendInput: (id: string, input: any) => api.post(`/sessions/${id}/input`, input),
};
