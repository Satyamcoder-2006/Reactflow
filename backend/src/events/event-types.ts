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

// ---------------------------------------------------------------------------
// Session Lifecycle
// ---------------------------------------------------------------------------

export enum SessionLifecycleStep {
    PENDING = 'PENDING',
    BOOTING = 'BOOTING',
    INSTALLING_APK = 'INSTALLING_APK',
    SETTING_UP_METRO = 'SETTING_UP_METRO',
    LAUNCHING_APP = 'LAUNCHING_APP',
    STREAM_STARTING = 'STREAM_STARTING',
    LIVE = 'LIVE',
    WAITING_FOR_BUILD = 'WAITING_FOR_BUILD',
    ERROR = 'ERROR',
}

export interface SessionLifecycleEvent {
    sessionId: string;
    step: SessionLifecycleStep;
    message?: string;
    timestamp: number;
}

export interface TapInputEvent {
    sessionId: string;
    x: number;
    y: number;
    frontendWidth: number;
    frontendHeight: number;
}

export interface SwipeInputEvent extends TapInputEvent {
    x2: number;
    y2: number;
    duration: number;
}
