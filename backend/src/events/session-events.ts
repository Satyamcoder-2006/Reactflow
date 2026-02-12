import { Redis } from 'ioredis';

export enum SessionEventType {
    STATUS_CHANGED = 'session:status',
    RELOAD_TRIGGERED = 'session:reload',
    ERROR_OCCURRED = 'session:error',
    LOGS_UPDATED = 'session:logs'
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
        buildId?: string;
    };
    timestamp: string;
}

export class SessionEventPublisher {
    constructor(private redis: Redis) { }

    async publish(event: SessionEvent) {
        await this.redis.publish(
            'session-events',
            JSON.stringify(event)
        );
    }

    async publishStatusChange(
        sessionId: string,
        userId: string,
        status: string
    ) {
        await this.publish({
            type: SessionEventType.STATUS_CHANGED,
            sessionId,
            userId,
            data: { status },
            timestamp: new Date().toISOString()
        });
    }

    async publishReload(sessionId: string, userId: string, buildId?: string) {
        await this.publish({
            type: SessionEventType.RELOAD_TRIGGERED,
            sessionId,
            userId,
            data: { message: 'Hot reload triggered', buildId },
            timestamp: new Date().toISOString()
        });
    }

    async publishError(sessionId: string, userId: string, error: string, message?: string) {
        await this.publish({
            type: SessionEventType.ERROR_OCCURRED,
            sessionId,
            userId,
            data: { error, message },
            timestamp: new Date().toISOString()
        });
    }
}
