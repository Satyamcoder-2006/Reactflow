import { Redis } from 'ioredis';
import { BuildEvent, BuildEventType, SessionEvent, SessionEventType } from './event-types';

export class EventPublisher {
    constructor(private redis: Redis) { }

    // Build Events
    async publishBuildEvent(event: BuildEvent) {
        await this.redis.publish('build-events', JSON.stringify(event));
    }

    async publishBuildStatus(
        buildId: string,
        userId: string,
        repoId: string,
        status: string
    ) {
        await this.publishBuildEvent({
            type: BuildEventType.STATUS_CHANGED,
            buildId,
            userId,
            repoId,
            data: { status },
            timestamp: new Date()
        });
    }

    async publishBuildLogs(
        buildId: string,
        userId: string,
        repoId: string,
        logs: string[]
    ) {
        await this.publishBuildEvent({
            type: BuildEventType.LOGS_UPDATED,
            buildId,
            userId,
            repoId,
            data: { logs },
            timestamp: new Date()
        });
    }

    async publishBuildSuccess(
        buildId: string,
        userId: string,
        repoId: string,
        apkPath: string
    ) {
        await this.publishBuildEvent({
            type: BuildEventType.SUCCESS,
            buildId,
            userId,
            repoId,
            data: { status: 'SUCCESS', apkPath },
            timestamp: new Date()
        });
    }

    async publishBuildFailed(
        buildId: string,
        userId: string,
        repoId: string,
        error: string
    ) {
        await this.publishBuildEvent({
            type: BuildEventType.FAILED,
            buildId,
            userId,
            repoId,
            data: { status: 'FAILED', error },
            timestamp: new Date()
        });
    }

    // Session Events
    async publishSessionEvent(event: SessionEvent) {
        await this.redis.publish('session-events', JSON.stringify(event));
    }

    async publishSessionStatus(
        sessionId: string,
        userId: string,
        status: string
    ) {
        await this.publishSessionEvent({
            type: SessionEventType.STATUS_CHANGED,
            sessionId,
            userId,
            data: { status },
            timestamp: new Date()
        });
    }

    async publishSessionReload(sessionId: string, userId: string, buildId?: string) {
        await this.publishSessionEvent({
            type: SessionEventType.RELOAD_TRIGGERED,
            sessionId,
            userId,
            data: { message: 'Hot reload triggered', buildId },
            timestamp: new Date()
        });
    }

    async publishSessionError(
        sessionId: string,
        userId: string,
        error: string
    ) {
        await this.publishSessionEvent({
            type: SessionEventType.ERROR_OCCURRED,
            sessionId,
            userId,
            data: { error },
            timestamp: new Date()
        });
    }

    async publishSessionStarted(
        sessionId: string,
        userId: string,
        emulatorUrl: string
    ) {
        await this.publishSessionEvent({
            type: SessionEventType.STARTED,
            sessionId,
            userId,
            data: { status: 'RUNNING', emulatorUrl },
            timestamp: new Date()
        });
    }
}
