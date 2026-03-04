import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import { prisma } from '../db/prisma';
import { DockerService } from './docker.service';
import { MetroService } from './metro.service';
import { AdbService, adbService, AdbError } from './adb.service';
import { logger } from '../utils/logger';
import { redis } from '../config/redis';
import { env } from '../config/env';
import { SessionLifecycleStep, SessionLifecycleEvent } from '../events/event-types';

/** Check ADB connectivity every 30 seconds */
const WATCHDOG_INTERVAL = 30 * 1_000;
/** Max ADB failures before flagging the session */
const MAX_ADB_FAILURES = 3;
/** Milliseconds to wait after `am start` before checking PID */
const POST_LAUNCH_CHECK_DELAY = 3_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Emit a session:lifecycle event over Redis pub/sub so the frontend updates. */
async function emitLifecycle(
    sessionId: string,
    step: SessionLifecycleStep,
    message?: string,
): Promise<void> {
    const event: SessionLifecycleEvent = {
        sessionId,
        step,
        message,
        timestamp: Date.now(),
    };
    await redis.publish('session-lifecycle', JSON.stringify(event));
    logger.info(`[EmulatorService] lifecycle ${sessionId}: ${step}${message ? ` — ${message}` : ''}`);
}

// ---------------------------------------------------------------------------
// EmulatorService
// ---------------------------------------------------------------------------

export class EmulatorService {
    private docker: DockerService;
    private metro: MetroService;
    private adb: AdbService;
    private watchdogs: Map<string, NodeJS.Timeout> = new Map();
    private adbFailures: Map<string, number> = new Map();
    /** Map from sessionId to running scrcpy/stream child process. */
    private streamProcesses: Map<string, ChildProcess> = new Map();

    constructor() {
        this.docker = new DockerService();
        this.metro = new MetroService();
        this.adb = adbService;
    }

    // -------------------------------------------------------------------------
    // getContainerIp
    // -------------------------------------------------------------------------

    /**
     * Get the IP address of a Docker container on the emulator network.
     *
     * Tries `env.EMULATOR_NETWORK` first, then falls back to "bridge".
     */
    async getContainerIp(containerId: string): Promise<string> {
        const container = (this.docker as any).docker.getContainer(containerId);
        const data = await container.inspect();
        const networks = data.NetworkSettings?.Networks ?? {};

        const ip =
            networks[env.EMULATOR_NETWORK]?.IPAddress ||
            networks['bridge']?.IPAddress;

        if (!ip) {
            throw new Error(
                `Cannot find IP for container ${containerId} ` +
                `(networks: ${Object.keys(networks).join(', ')})`,
            );
        }

        logger.info(`[EmulatorService] container ${containerId} IP: ${ip}`);
        return ip;
    }

    // -------------------------------------------------------------------------
    // createSession
    // -------------------------------------------------------------------------

    /**
     * Create a new emulator session for a repository.
     *
     * Starts the Redroid container, creates the DB record, then kicks off the
     * full boot-and-deploy flow in the background.
     */
    async createSession(config: {
        userId: string;
        repoId: string;
        shellId?: string;
        sessionId?: string;
        config?: {
            deviceType?: string;
            androidVersion?: number;
        };
    }) {
        logger.info(`[EmulatorService] createSession for repo ${config.repoId}`);

        // Resolve Metro URL
        let metroUrl = await this.metro.getMetroUrl(config.repoId);
        if (!metroUrl) {
            logger.warn(`Metro not running for repo ${config.repoId}, using default loopback.`);
            metroUrl = 'http://10.0.2.2:8081';
        }

        // Resolve APK URL
        let shellId = config.shellId;
        let apkUrl: string | undefined;

        if (!shellId) {
            const latestBuild = await prisma.build.findFirst({
                where: { repoId: config.repoId, status: 'SUCCESS' },
                orderBy: { completedAt: 'desc' },
            });

            if (!latestBuild?.apkUrl) {
                // No build yet — create a session that waits for the first build
                logger.warn(`[EmulatorService] No successful build for repo ${config.repoId}.`);
                const waitingSession = await prisma.emulatorSession.create({
                    data: {
                        repo: { connect: { id: config.repoId } },
                        user: { connect: { id: config.userId } },
                        containerId: `pending-${Date.now()}`,
                        containerName: `pending-${config.repoId.substring(0, 8)}`,
                        adbPort: 0,
                        status: 'STARTING',
                    } as any,
                });
                await emitLifecycle(waitingSession.id, SessionLifecycleStep.WAITING_FOR_BUILD,
                    'No build found — trigger a build and the emulator will start automatically.');
                return waitingSession;
            }

            shellId = latestBuild.id;
            apkUrl = latestBuild.apkUrl;
        } else {
            const build = await prisma.build.findUnique({ where: { id: shellId } });
            if (build?.apkUrl) {
                apkUrl = build.apkUrl;
            } else {
                const shell = await prisma.shell.findUnique({ where: { id: shellId } });
                if (shell?.apkUrl) apkUrl = shell.apkUrl;
            }

            if (!apkUrl) {
                throw new Error('BUILD_NOT_FOUND');
            }
        }

        // Start Redroid container
        const { containerId, adbPort } = await this.docker.startEmulator({
            sessionId: config.sessionId ?? `new-${Date.now()}`,
            shellApkUrl: apkUrl,
            metroUrl,
        });

        // Resolve Metro DB record
        const metroInstance = await prisma.metroInstance.findUnique({
            where: { repoId: config.repoId },
        });

        // Create / update session record
        const sessionData: Record<string, unknown> = {
            repo: { connect: { id: config.repoId } },
            user: { connect: { id: config.userId } },
            build: { connect: { id: shellId } },
            metro: metroInstance ? { connect: { id: metroInstance.id } } : undefined,
            containerId,
            containerName: `emulator-${containerId.substring(0, 12)}`,
            adbPort,
            status: 'STARTING',
        };

        let session;
        if (config.sessionId) {
            session = await prisma.emulatorSession.update({
                where: { id: config.sessionId },
                data: sessionData as any,
            });
        } else {
            session = await prisma.emulatorSession.create({ data: sessionData as any });
        }

        // Start watchdog
        this.startWatchdog(session.id, containerId);

        // Kick off full lifecycle in background — emits WS events as it progresses
        this.fullBootAndDeployFlow(session, apkUrl, containerId).catch((err) => {
            logger.error(`[EmulatorService] Boot/deploy failed for session ${session.id}: ${err}`);
        });

        logger.info(`[EmulatorService] session created: ${session.id}`);
        return session;
    }

    // -------------------------------------------------------------------------
    // fullBootAndDeployFlow  (private — the main 10-step pipeline)
    // -------------------------------------------------------------------------

    private async fullBootAndDeployFlow(
        session: { id: string; containerId: string },
        apkS3Url: string,
        containerId: string,
    ): Promise<void> {
        const sessionId = session.id;

        try {
            // Step 1: Get container IP and build serial
            await emitLifecycle(sessionId, SessionLifecycleStep.BOOTING, 'Waiting for Android to boot...');
            const ip = await this.getContainerIp(containerId);
            const serial = `${ip}:${env.REDROID_ADB_PORT}`;

            // Connect ADB and wait for full boot
            await this.adb.connect(ip, env.REDROID_ADB_PORT);
            await this.adb.waitForBoot(serial, 120_000);

            // Step 2: Download + install APK
            await emitLifecycle(sessionId, SessionLifecycleStep.INSTALLING_APK, 'Downloading and installing APK...');
            const localApkPath = await this.downloadApk(apkS3Url, sessionId);

            try {
                await this.adb.install(serial, localApkPath);
            } finally {
                await fs.remove(localApkPath).catch(() => { /* best effort cleanup */ });
            }

            // Step 3: Set up Metro reverse tunnel
            await emitLifecycle(sessionId, SessionLifecycleStep.SETTING_UP_METRO, 'Tunnelling Metro port...');
            await this.adb.reverse(serial, 8081, 8081);

            // Step 4: Determine package name and launch
            await emitLifecycle(sessionId, SessionLifecycleStep.LAUNCHING_APP, 'Launching app...');
            const packageName = await this.resolvePackageName(sessionId);
            await this.adb.launch(serial, packageName);

            // Crash-detection: wait 3 s then verify PID
            await sleep(POST_LAUNCH_CHECK_DELAY);
            const running = await this.adb.checkAppRunning(serial, packageName);
            if (!running) {
                logger.warn(`[EmulatorService] App not running after launch on ${sessionId}, retrying once.`);
                await this.adb.launch(serial, packageName);
            }

            // Step 5: Start MJPEG stream process
            await emitLifecycle(sessionId, SessionLifecycleStep.STREAM_STARTING, 'Starting video stream...');
            this.startStreamProcess(sessionId, serial);

            // Step 6: Mark LIVE
            await prisma.emulatorSession.update({
                where: { id: sessionId },
                data: { status: 'RUNNING', startedAt: new Date() },
            }).catch(() => { /* non-fatal */ });

            await emitLifecycle(sessionId, SessionLifecycleStep.LIVE);
            logger.info(`[EmulatorService] Session ${sessionId} is LIVE.`);

        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`[EmulatorService] fullBootAndDeployFlow failed for ${sessionId}: ${message}`);

            await emitLifecycle(sessionId, SessionLifecycleStep.ERROR, message);
            await prisma.emulatorSession.update({
                where: { id: sessionId },
                data: { status: 'ERROR' },
            }).catch(() => { /* ignore cascade errors */ });
        }
    }

    // -------------------------------------------------------------------------
    // deployToExistingSession  (called by shell-builder after build completion)
    // -------------------------------------------------------------------------

    /**
     * Install a new APK into an already-running emulator session for a repo.
     * Used for "native change" hot-upgrade: reinstalls APK without rebooting.
     *
     * If no active session is found, logs a warning and returns without error.
     *
     * @param repoId      The repository ID.
     * @param apkS3Url    S3 / local URL of the freshly built APK.
     * @param packageName Android package name.
     */
    async deployToExistingSession(
        repoId: string,
        apkS3Url: string,
        packageName: string,
    ): Promise<void> {
        const session = await prisma.emulatorSession.findFirst({
            where: { repoId, status: 'RUNNING' },
        });

        if (!session) {
            logger.warn(`[EmulatorService] deployToExistingSession: no running session for repo ${repoId}`);
            return;
        }

        const sessionId = session.id;
        logger.info(`[EmulatorService] deploying new APK to existing session ${sessionId}`);

        try {
            await emitLifecycle(sessionId, SessionLifecycleStep.INSTALLING_APK, 'Installing updated APK...');

            const ip = await this.getContainerIp(session.containerId);
            const serial = `${ip}:${env.REDROID_ADB_PORT}`;

            const localApkPath = await this.downloadApk(apkS3Url, `redeploy-${sessionId}`);
            try {
                await this.adb.install(serial, localApkPath);
            } finally {
                await fs.remove(localApkPath).catch(() => { /* best-effort */ });
            }

            await emitLifecycle(sessionId, SessionLifecycleStep.SETTING_UP_METRO, 'Re-establishing Metro tunnel...');
            await this.adb.reverse(serial, 8081, 8081);

            await emitLifecycle(sessionId, SessionLifecycleStep.LAUNCHING_APP, 'Relaunching app...');
            await this.adb.launch(serial, packageName);

            await emitLifecycle(sessionId, SessionLifecycleStep.LIVE);
            logger.info(`[EmulatorService] Re-deploy complete for session ${sessionId}`);

        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`[EmulatorService] deployToExistingSession failed: ${message}`);
            await emitLifecycle(sessionId, SessionLifecycleStep.ERROR, message);
            throw err;
        }
    }

    // -------------------------------------------------------------------------
    // setupMetroTunnel
    // -------------------------------------------------------------------------

    /**
     * (Re-)establish the `adb reverse tcp:8081 tcp:8081` rule for a session.
     * Useful if the tunnel drops after a Metro container restart.
     *
     * @param sessionId  The emulator session ID.
     */
    async setupMetroTunnel(sessionId: string): Promise<void> {
        const session = await prisma.emulatorSession.findUnique({ where: { id: sessionId } });
        if (!session) throw new Error(`Session ${sessionId} not found`);

        const ip = await this.getContainerIp(session.containerId);
        const serial = `${ip}:${env.REDROID_ADB_PORT}`;

        await this.adb.reverse(serial, 8081, 8081);
        logger.info(`[EmulatorService] Metro tunnel re-established for session ${sessionId}`);
    }

    // -------------------------------------------------------------------------
    // sendTap / sendSwipe
    // -------------------------------------------------------------------------

    /**
     * Forward a tap event from the browser to the emulator, scaling
     * from rendered frontend dimensions to native device resolution.
     */
    async sendTap(
        sessionId: string,
        userId: string,
        x: number,
        y: number,
        frontendWidth: number,
        frontendHeight: number,
    ): Promise<void> {
        const session = await prisma.emulatorSession.findFirst({
            where: { id: sessionId, userId },
        });
        if (!session || session.status !== 'RUNNING') throw new Error('Session not running');

        const scaleX = env.REDROID_SCREEN_WIDTH / frontendWidth;
        const scaleY = env.REDROID_SCREEN_HEIGHT / frontendHeight;
        const deviceX = Math.round(x * scaleX);
        const deviceY = Math.round(y * scaleY);

        const ip = await this.getContainerIp(session.containerId);
        const serial = `${ip}:${env.REDROID_ADB_PORT}`;

        await this.adb.tap(serial, deviceX, deviceY);

        await prisma.emulatorSession.update({
            where: { id: sessionId },
            data: { lastActivity: new Date(), interactionCount: { increment: 1 } } as any,
        });
    }

    /**
     * Forward a swipe gesture from the browser to the emulator.
     */
    async sendSwipe(
        sessionId: string,
        userId: string,
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        duration: number,
        frontendWidth: number,
        frontendHeight: number,
    ): Promise<void> {
        const session = await prisma.emulatorSession.findFirst({
            where: { id: sessionId, userId },
        });
        if (!session || session.status !== 'RUNNING') throw new Error('Session not running');

        const scaleX = env.REDROID_SCREEN_WIDTH / frontendWidth;
        const scaleY = env.REDROID_SCREEN_HEIGHT / frontendHeight;

        const ip = await this.getContainerIp(session.containerId);
        const serial = `${ip}:${env.REDROID_ADB_PORT}`;

        await this.adb.swipe(
            serial,
            Math.round(x1 * scaleX), Math.round(y1 * scaleY),
            Math.round(x2 * scaleX), Math.round(y2 * scaleY),
            duration,
        );

        await prisma.emulatorSession.update({
            where: { id: sessionId },
            data: { lastActivity: new Date(), interactionCount: { increment: 1 } } as any,
        });
    }

    // -------------------------------------------------------------------------
    // sendInput (legacy — kept for backward compat)
    // -------------------------------------------------------------------------

    /**
     * Generic input dispatcher (tap / swipe / key / text).
     * Uses local exec inside container for key/text; ADB for tap/swipe.
     */
    async sendInput(
        sessionId: string,
        userId: string,
        input: {
            type: 'tap' | 'swipe' | 'key' | 'text';
            x?: number;
            y?: number;
            x2?: number;
            y2?: number;
            key?: string;
            text?: string;
        },
    ): Promise<void> {
        const session = await prisma.emulatorSession.findFirst({
            where: { id: sessionId, userId },
        });
        if (!session || session.status !== 'RUNNING') throw new Error('Session not running');

        const ip = await this.getContainerIp(session.containerId);
        const serial = `${ip}:${env.REDROID_ADB_PORT}`;

        switch (input.type) {
            case 'tap':
                await this.adb.tap(serial, input.x!, input.y!);
                break;
            case 'swipe':
                await this.adb.swipe(serial, input.x!, input.y!, input.x2!, input.y2!, 300);
                break;
            case 'key':
                await this.adb.sendKey(serial, input.key!);
                break;
            case 'text':
                await this.docker.execInContainer(session.containerId, [
                    'sh', '-c', `input text '${input.text!.replace(/'/g, "\\'")}'`,
                ]);
                break;
            default:
                throw new Error(`Unknown input type: ${(input as any).type}`);
        }

        await prisma.emulatorSession.update({
            where: { id: sessionId },
            data: { lastActivity: new Date(), interactionCount: { increment: 1 } } as any,
        });
    }

    // -------------------------------------------------------------------------
    // stopSession
    // -------------------------------------------------------------------------

    /**
     * Stop the emulator container and clean up all associated processes.
     */
    async stopSession(sessionId: string, userId: string | 'SYSTEM'): Promise<void> {
        const query =
            userId === 'SYSTEM'
                ? { where: { id: sessionId } }
                : { where: { id: sessionId, userId } };

        const session = await prisma.emulatorSession.findFirst(query as any);
        if (!session) throw new Error('Session not found');

        logger.info(`[EmulatorService] stopping session: ${sessionId}`);

        // Stop watchdog
        this.stopWatchdog(sessionId);
        this.adbFailures.delete(sessionId);

        // Stop stream process
        const streamProc = this.streamProcesses.get(sessionId);
        if (streamProc && !streamProc.killed) {
            streamProc.kill('SIGTERM');
            this.streamProcesses.delete(sessionId);
        }

        // Disconnect ADB
        try {
            const ip = await this.getContainerIp(session.containerId);
            await this.adb.disconnect(`${ip}:${env.REDROID_ADB_PORT}`);
        } catch {
            /* ignore — container may already be dead */
        }

        // Stop Docker container
        await this.docker.stopContainer(session.containerId).catch((err) =>
            logger.error(`[EmulatorService] container stop error: ${err}`),
        );

        await prisma.emulatorSession.update({
            where: { id: sessionId },
            data: { status: 'STOPPED', stoppedAt: new Date() },
        });
    }

    // -------------------------------------------------------------------------
    // reloadSession
    // -------------------------------------------------------------------------

    /**
     * Trigger React Native hot reload on a running session.
     */
    async reloadSession(sessionId: string, userId: string): Promise<void> {
        const session = await prisma.emulatorSession.findFirst({
            where: { id: sessionId, userId },
            include: { repo: true } as any,
        });
        if (!session) throw new Error('Session not found');

        await this.metro.triggerHotReload(session.repoId);

        const ip = await this.getContainerIp(session.containerId);
        const serial = `${ip}:${env.REDROID_ADB_PORT}`;

        // Double-press R to trigger RN dev menu reload
        await this.adb.sendKey(serial, 'KEYCODE_R');
        await sleep(100);
        await this.adb.sendKey(serial, 'KEYCODE_R');
    }

    // -------------------------------------------------------------------------
    // getScreenshot / getScreenshotJpeg  (fallback for when scrcpy isn't active)
    // -------------------------------------------------------------------------

    /** Get a raw PNG screenshot from the emulator via execInContainer. */
    async getScreenshot(sessionId: string, userId: string): Promise<Buffer> {
        const session = await prisma.emulatorSession.findFirst({ where: { id: sessionId, userId } });
        if (!session || session.status !== 'RUNNING') throw new Error('Session not running');
        return this.docker.getScreenshot(session.containerId);
    }

    /** Get a JPEG screenshot from the emulator (sharp-compressed). */
    async getScreenshotJpeg(sessionId: string, userId: string): Promise<Buffer> {
        const session = await prisma.emulatorSession.findFirst({ where: { id: sessionId, userId } });
        if (!session || session.status !== 'RUNNING') throw new Error('Session not running');
        return this.docker.getScreenshotJpeg(session.containerId);
    }

    // -------------------------------------------------------------------------
    // cleanupExpiredSessions
    // -------------------------------------------------------------------------

    /** Stop sessions that have been idle for more than 30 minutes. */
    async cleanupExpiredSessions(): Promise<void> {
        const EXPIRE_TIMEOUT = 30 * 60 * 1_000;
        const expired = await prisma.emulatorSession.findMany({
            where: {
                status: 'RUNNING',
                lastActivity: { lt: new Date(Date.now() - EXPIRE_TIMEOUT) },
            },
        });

        for (const session of expired) {
            logger.info(`[EmulatorService] cleaning up expired session ${session.id}`);
            await this.stopSession(session.id, 'SYSTEM').catch(() => { });
        }
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /** Download an APK from an S3 (or local /storage) URL to the temp dir. */
    private async downloadApk(apkUrl: string, label: string): Promise<string> {
        await fs.ensureDir(env.APK_TEMP_DIR);
        const localPath = path.join(env.APK_TEMP_DIR, `${label}.apk`);

        if (apkUrl.startsWith('/') || apkUrl.startsWith('file://')) {
            // Local filesystem APK
            const srcPath = apkUrl.replace('file://', '');
            await fs.copyFile(srcPath, localPath);
            logger.info(`[EmulatorService] copied local APK to ${localPath}`);
            return localPath;
        }

        if (apkUrl.startsWith('s3://') || (env.S3_BUCKET && apkUrl.includes(env.S3_BUCKET ?? ''))) {
            // AWS S3 download
            const AWS = await import('aws-sdk');
            const s3 = new AWS.S3({
                accessKeyId: env.AWS_ACCESS_KEY_ID,
                secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
                region: env.AWS_REGION,
            });

            const key = apkUrl.includes('s3://')
                ? apkUrl.split('/').slice(3).join('/')
                : new URL(apkUrl).pathname.slice(1);

            const stream = s3
                .getObject({ Bucket: env.S3_BUCKET!, Key: key })
                .createReadStream();

            await new Promise<void>((resolve, reject) => {
                const out = fs.createWriteStream(localPath);
                stream.pipe(out);
                out.on('finish', resolve);
                out.on('error', reject);
                stream.on('error', reject);
            });

            logger.info(`[EmulatorService] downloaded S3 APK to ${localPath}`);
            return localPath;
        }

        // HTTP/HTTPS URL — download via fetch (Node 18+)
        const response = await fetch(apkUrl);
        if (!response.ok) {
            throw new Error(`Failed to download APK from ${apkUrl}: HTTP ${response.status}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(localPath, buffer);
        logger.info(`[EmulatorService] downloaded HTTP APK to ${localPath}`);
        return localPath;
    }

    /**
     * Resolve the Android package name for a session's repo.
     * Falls back to 'com.anonymous' if not stored.
     */
    private async resolvePackageName(sessionId: string): Promise<string> {
        const session = await prisma.emulatorSession.findUnique({
            where: { id: sessionId },
            include: { repo: true } as any,
        });

        const repo = (session as any)?.repo;
        // If we stored it on the repo record — use it
        if (repo?.packageName) return repo.packageName as string;

        logger.warn(`[EmulatorService] No package name for session ${sessionId}, using default`);
        return 'com.anonymous';
    }

    /**
     * Start a screenshot-polling MJPEG stream process for a session.
     *
     * We attempt scrcpy first. If it fails to start (e.g. not installed), we
     * fall back to the screenshot-polling approach in the route handler which
     * already works.
     */
    private startStreamProcess(sessionId: string, serial: string): void {
        if (this.streamProcesses.has(sessionId)) {
            logger.debug(`[EmulatorService] stream already running for ${sessionId}`);
            return;
        }

        const args = [
            '--serial', serial,
            '--no-audio',
            '--no-window',
            '--max-fps', String(env.REDROID_FPS),
        ];

        logger.info(`[EmulatorService] spawning scrcpy for session ${sessionId}`);
        const proc = spawn(env.SCRCPY_PATH, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        this.streamProcesses.set(sessionId, proc);

        proc.stderr?.on('data', (chunk: Buffer) => {
            logger.debug(`[scrcpy:${sessionId}] ${chunk.toString('utf8').trim()}`);
        });

        proc.on('error', (err) => {
            logger.warn(`[EmulatorService] scrcpy spawn error for ${sessionId}: ${err.message} — stream will fall back to screenshot polling`);
            this.streamProcesses.delete(sessionId);
        });

        proc.on('exit', (code) => {
            this.streamProcesses.delete(sessionId);
            if (code !== 0 && code !== null) {
                logger.error(`[EmulatorService] scrcpy exited with code ${code} for session ${sessionId}`);
                emitLifecycle(sessionId, SessionLifecycleStep.ERROR, `Stream process exited (code ${code})`).catch(() => { });
            }
        });
    }

    /** Get the stream process for a session (used by the route for piping). */
    getStreamProcess(sessionId: string): ChildProcess | undefined {
        return this.streamProcesses.get(sessionId);
    }

    // Watchdog
    private startWatchdog(sessionId: string, containerId: string): void {
        if (this.watchdogs.has(sessionId)) return;

        const interval = setInterval(async () => {
            try {
                const isRunning = await this.docker.isContainerRunning(containerId);
                if (!isRunning) {
                    logger.warn(`[EmulatorService] container stopped for session ${sessionId}`);
                    await this.stopSession(sessionId, 'SYSTEM').catch(() => { });
                    return;
                }

                const ip = await this.getContainerIp(containerId).catch(() => null);
                if (ip) {
                    const devices = await this.adb.getDeviceList();
                    const serial = `${ip}:${env.REDROID_ADB_PORT}`;
                    if (!devices.includes(serial)) {
                        const failures = (this.adbFailures.get(sessionId) ?? 0) + 1;
                        this.adbFailures.set(sessionId, failures);
                        logger.warn(`[EmulatorService] ADB failure (${failures}/${MAX_ADB_FAILURES}) for ${sessionId}`);

                        if (failures >= MAX_ADB_FAILURES) {
                            logger.error(`[EmulatorService] ADB dead for ${sessionId}, attempting reconnect`);
                            await this.adb.connect(ip, env.REDROID_ADB_PORT).catch(() => { });
                            this.adbFailures.set(sessionId, 0);
                        }
                    } else {
                        this.adbFailures.set(sessionId, 0);
                    }
                }
            } catch (err) {
                logger.error(`[EmulatorService] watchdog error for ${sessionId}: ${err}`);
            }
        }, WATCHDOG_INTERVAL);

        this.watchdogs.set(sessionId, interval);
    }

    private stopWatchdog(sessionId: string): void {
        const interval = this.watchdogs.get(sessionId);
        if (interval) {
            clearInterval(interval);
            this.watchdogs.delete(sessionId);
        }
    }
}

export const emulatorService = new EmulatorService();
