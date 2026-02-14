export enum BuildEventType {
    STATUS_CHANGED = 'build:status',
    LOGS_UPDATED = 'build:logs',
    SUCCESS = 'build:success',
    FAILED = 'build:failed',
    STARTED = 'build:started'
}

export enum SessionEventType {
    STATUS_CHANGED = 'session:status',
    RELOAD_TRIGGERED = 'session:reload',
    ERROR_OCCURRED = 'session:error',
    LOGS_UPDATED = 'session:logs',
    STARTED = 'session:started',
    STOPPED = 'session:stopped'
}

export interface BuildEvent {
    type: BuildEventType;
    buildId: string;
    userId: string;
    repoId: string;
    data: {
        status?: string;
        logs?: string[];
        error?: string;
        apkPath?: string;
    };
    timestamp: Date;
}

export interface SessionEvent {
    type: SessionEventType;
    sessionId: string;
    userId: string;
    data: {
        status?: string;
        message?: string;
        error?: string;
        logs?: string[];
        emulatorUrl?: string;
        buildId?: string;
    };
    timestamp: Date;
}
