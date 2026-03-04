import { spawn } from 'child_process';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/** Structured error thrown by all AdbService methods. */
export class AdbError extends Error {
    public readonly code: string;
    public readonly serial?: string;

    constructor(message: string, code: string, serial?: string) {
        super(message);
        this.name = 'AdbError';
        this.code = code;
        this.serial = serial;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run an adb command and resolve with { stdout, stderr, exitCode }. */
function runAdb(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
        const proc = spawn(env.ADB_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf8');
        });

        proc.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8');
        });

        proc.on('error', (err) => {
            reject(new AdbError(`Failed to spawn adb: ${err.message}`, 'SPAWN_ERROR'));
        });

        proc.on('close', (exitCode) => {
            resolve({ stdout, stderr, exitCode: exitCode ?? -1 });
        });
    });
}

/** Sleep for the given number of milliseconds. */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// AdbService
// ---------------------------------------------------------------------------

export class AdbService {
    // -------------------------------------------------------------------------
    // connect
    // -------------------------------------------------------------------------

    /**
     * Connect ADB to a remote device.
     *
     * IMPORTANT: `adb connect` returns exit code 0 even on failure, so stdout
     * must be inspected for "connected" / "already connected" vs "refused" / "failed".
     *
     * Retries up to 3 times with a 5-second delay between attempts.
     *
     * @param host  IP address of the remote device.
     * @param port  ADB port (usually 5555).
     * @returns     The serial string "<host>:<port>" on success.
     */
    async connect(host: string, port: number): Promise<string> {
        const serial = `${host}:${port}`;
        const maxAttempts = 3;
        const retryDelay = 5_000;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            logger.info(`[ADB] connect attempt ${attempt}/${maxAttempts} → ${serial}`);

            const { stdout, stderr } = await runAdb(['connect', serial]);
            const output = (stdout + stderr).toLowerCase();

            if (output.includes('connected') || output.includes('already connected')) {
                logger.info(`[ADB] connect succeeded: ${serial}`);
                return serial;
            }

            logger.warn(`[ADB] connect attempt ${attempt} failed for ${serial}: ${stdout.trim()}`);

            if (attempt < maxAttempts) {
                await sleep(retryDelay);
            }
        }

        throw new AdbError(
            `Failed to connect to ${serial} after ${maxAttempts} attempts`,
            'CONNECT_FAILED',
            serial,
        );
    }

    // -------------------------------------------------------------------------
    // waitForDevice
    // -------------------------------------------------------------------------

    /**
     * Poll `adb -s <serial> get-state` until the device is online.
     *
     * @param serial     Device serial string.
     * @param timeoutMs  Maximum wait time in milliseconds.
     */
    async waitForDevice(serial: string, timeoutMs: number): Promise<void> {
        logger.info(`[ADB] waitForDevice: ${serial} (timeout ${timeoutMs}ms)`);
        const deadline = Date.now() + timeoutMs;
        const pollInterval = 2_000;

        while (Date.now() < deadline) {
            const { stdout } = await runAdb(['-s', serial, 'get-state']);
            if (stdout.trim() === 'device') {
                logger.info(`[ADB] device online: ${serial}`);
                return;
            }
            await sleep(pollInterval);
        }

        throw new AdbError(
            `Timed out waiting for device ${serial} after ${timeoutMs}ms`,
            'DEVICE_TIMEOUT',
            serial,
        );
    }

    // -------------------------------------------------------------------------
    // waitForBoot
    // -------------------------------------------------------------------------

    /**
     * Poll `adb -s <serial> shell getprop sys.boot_completed` until the value
     * equals "1". Empty string is treated as not-ready (normal during early boot).
     *
     * @param serial     Device serial string.
     * @param timeoutMs  Maximum wait time in milliseconds.
     */
    async waitForBoot(serial: string, timeoutMs: number): Promise<void> {
        logger.info(`[ADB] waitForBoot: ${serial} (timeout ${timeoutMs}ms)`);
        const deadline = Date.now() + timeoutMs;
        const pollInterval = 3_000;

        while (Date.now() < deadline) {
            try {
                const { stdout } = await runAdb(['-s', serial, 'shell', 'getprop', 'sys.boot_completed']);
                const value = stdout.trim();

                if (value === '1') {
                    logger.info(`[ADB] boot complete on ${serial}`);
                    return;
                }

                // Empty string is normal during early boot — not an error.
                logger.debug(`[ADB] ${serial} boot_completed=${value || '(empty)'}, waiting...`);
            } catch (err) {
                // ADB may not yet be reachable during very early boot — ignore.
                logger.debug(`[ADB] getprop failed on ${serial}: ${err}`);
            }

            await sleep(pollInterval);
        }

        throw new AdbError(
            `Timed out waiting for boot on ${serial} after ${timeoutMs}ms`,
            'BOOT_TIMEOUT',
            serial,
        );
    }

    // -------------------------------------------------------------------------
    // install
    // -------------------------------------------------------------------------

    /**
     * Install an APK on the device.
     *
     * Handles INSTALL_FAILED_VERSION_DOWNGRADE by automatically adding the -d
     * flag and retrying once.
     *
     * @param serial   Device serial string.
     * @param apkPath  Absolute path to the APK file.
     */
    async install(serial: string, apkPath: string): Promise<void> {
        logger.info(`[ADB] install on ${serial}: ${apkPath}`);
        await this._doInstall(serial, apkPath, false);
    }

    private async _doInstall(serial: string, apkPath: string, allowDowngrade: boolean): Promise<void> {
        const args = ['-s', serial, 'install', '-r'];
        if (allowDowngrade) args.push('-d');
        args.push(apkPath);

        const { stdout, stderr } = await runAdb(args);
        const output = stdout + stderr;
        const lastLine = output.trim().split('\n').pop()?.trim() ?? '';

        logger.debug(`[ADB] install output: ${lastLine}`);

        if (lastLine.includes('Success')) {
            logger.info(`[ADB] install succeeded on ${serial}`);
            return;
        }

        // Parse failure code
        const failureMatch = output.match(/Failure\s*\[([^\]]+)\]/);
        const errorCode = failureMatch ? failureMatch[1] : 'UNKNOWN';

        if (errorCode === 'INSTALL_FAILED_VERSION_DOWNGRADE' && !allowDowngrade) {
            logger.warn(`[ADB] version downgrade detected, retrying with -d flag`);
            await this._doInstall(serial, apkPath, true);
            return;
        }

        throw new AdbError(
            `APK install failed on ${serial}: ${errorCode}`,
            errorCode,
            serial,
        );
    }

    // -------------------------------------------------------------------------
    // launch
    // -------------------------------------------------------------------------

    /**
     * Launch the app's main activity.
     *
     * Tries `<packageName>/.MainActivity` first. If "Error type 3" (activity
     * not found) is returned, falls back to
     * `<packageName>/<packageName>.MainActivity`.
     *
     * @param serial       Device serial string.
     * @param packageName  Android package name (e.g. "com.myapp").
     */
    async launch(serial: string, packageName: string): Promise<void> {
        logger.info(`[ADB] launch ${packageName} on ${serial}`);

        const primaryActivity = `${packageName}/.MainActivity`;
        const { stdout: out1, exitCode: code1 } = await runAdb([
            '-s', serial, 'shell', 'am', 'start', '-n', primaryActivity,
        ]);

        if (code1 === 0 && out1.includes('Starting:')) {
            logger.info(`[ADB] launch succeeded: ${primaryActivity}`);
            return;
        }

        // Fallback activity path
        if (out1.includes('Error type 3')) {
            logger.warn(`[ADB] primary activity not found, trying fallback`);
            const fallbackActivity = `${packageName}/${packageName}.MainActivity`;
            const { stdout: out2, exitCode: code2 } = await runAdb([
                '-s', serial, 'shell', 'am', 'start', '-n', fallbackActivity,
            ]);

            if (code2 === 0 && out2.includes('Starting:')) {
                logger.info(`[ADB] launch succeeded with fallback: ${fallbackActivity}`);
                return;
            }

            throw new AdbError(
                `Failed to launch ${packageName} (fallback): ${out2.trim()}`,
                'LAUNCH_FAILED',
                serial,
            );
        }

        throw new AdbError(
            `Failed to launch ${packageName}: ${out1.trim()}`,
            'LAUNCH_FAILED',
            serial,
        );
    }

    // -------------------------------------------------------------------------
    // reverse
    // -------------------------------------------------------------------------

    /**
     * Add a reverse port-forward rule so that `localhost:<remotePort>` inside
     * Android routes to the host's `localhost:<localPort>`.
     *
     * Used to tunnel Metro's port 8081 into the emulator for hot reload.
     *
     * @param serial      Device serial string.
     * @param remotePort  Port inside Android (remote side).
     * @param localPort   Port on the ADB host (local side).
     */
    async reverse(serial: string, remotePort: number, localPort: number): Promise<void> {
        logger.info(`[ADB] reverse ${serial}: tcp:${remotePort} → tcp:${localPort}`);

        const { exitCode, stderr } = await runAdb([
            '-s', serial, 'reverse', `tcp:${remotePort}`, `tcp:${localPort}`,
        ]);

        if (exitCode !== 0) {
            throw new AdbError(
                `adb reverse failed on ${serial}: ${stderr.trim()}`,
                'REVERSE_FAILED',
                serial,
            );
        }

        logger.info(`[ADB] reverse rule established on ${serial}`);
    }

    // -------------------------------------------------------------------------
    // tap
    // -------------------------------------------------------------------------

    /**
     * Send a tap (touch) event to the device screen.
     *
     * @param serial  Device serial string.
     * @param x       X coordinate in device pixels.
     * @param y       Y coordinate in device pixels.
     */
    async tap(serial: string, x: number, y: number): Promise<void> {
        logger.debug(`[ADB] tap ${serial} @ (${x}, ${y})`);

        const { exitCode } = await runAdb(['-s', serial, 'shell', 'input', 'tap', String(x), String(y)]);

        if (exitCode !== 0) {
            throw new AdbError(`adb tap failed on ${serial}`, 'TAP_FAILED', serial);
        }
    }

    // -------------------------------------------------------------------------
    // swipe
    // -------------------------------------------------------------------------

    /**
     * Send a swipe gesture to the device screen.
     *
     * @param serial      Device serial string.
     * @param x1          Start X coordinate.
     * @param y1          Start Y coordinate.
     * @param x2          End X coordinate.
     * @param y2          End Y coordinate.
     * @param durationMs  Duration of the swipe in milliseconds.
     */
    async swipe(
        serial: string,
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        durationMs: number,
    ): Promise<void> {
        logger.debug(`[ADB] swipe ${serial}: (${x1},${y1}) → (${x2},${y2}) ${durationMs}ms`);

        const { exitCode } = await runAdb([
            '-s', serial, 'shell', 'input', 'swipe',
            String(x1), String(y1), String(x2), String(y2), String(durationMs),
        ]);

        if (exitCode !== 0) {
            throw new AdbError(`adb swipe failed on ${serial}`, 'SWIPE_FAILED', serial);
        }
    }

    // -------------------------------------------------------------------------
    // sendKey
    // -------------------------------------------------------------------------

    /**
     * Send a key event to the device.
     *
     * @param serial   Device serial string.
     * @param keycode  Android keyevent constant (e.g. "KEYCODE_BACK").
     */
    async sendKey(serial: string, keycode: string): Promise<void> {
        logger.debug(`[ADB] sendKey ${serial}: ${keycode}`);

        const { exitCode } = await runAdb(['-s', serial, 'shell', 'input', 'keyevent', keycode]);

        if (exitCode !== 0) {
            throw new AdbError(`adb keyevent failed on ${serial}`, 'KEY_FAILED', serial);
        }
    }

    // -------------------------------------------------------------------------
    // checkAppRunning
    // -------------------------------------------------------------------------

    /**
     * Check whether a package is currently running by inspecting its PID.
     *
     * @param serial       Device serial string.
     * @param packageName  Android package name.
     * @returns            true if a numeric PID is found, false otherwise.
     */
    async checkAppRunning(serial: string, packageName: string): Promise<boolean> {
        logger.debug(`[ADB] checkAppRunning ${serial}: ${packageName}`);

        const { stdout } = await runAdb(['-s', serial, 'shell', 'pidof', packageName]);
        const pid = stdout.trim();
        const isRunning = /^\d+/.test(pid);

        logger.debug(`[ADB] ${packageName} on ${serial}: pid="${pid}", running=${isRunning}`);
        return isRunning;
    }

    // -------------------------------------------------------------------------
    // getDeviceList
    // -------------------------------------------------------------------------

    /**
     * Return a list of currently connected and online ADB device serials.
     * Excludes the header line and any "offline" devices.
     *
     * @returns Array of serial strings.
     */
    async getDeviceList(): Promise<string[]> {
        logger.debug('[ADB] getDeviceList');

        const { stdout } = await runAdb(['devices']);
        const lines = stdout.trim().split('\n');

        // First line is always the header "List of devices attached"
        return lines
            .slice(1)
            .filter((line) => line.trim() && !line.includes('offline'))
            .map((line) => line.split('\t')[0].trim())
            .filter(Boolean);
    }

    // -------------------------------------------------------------------------
    // disconnect
    // -------------------------------------------------------------------------

    /**
     * Disconnect from a remote ADB device.
     *
     * @param serial  Device serial string (e.g. "192.168.0.1:5555").
     */
    async disconnect(serial: string): Promise<void> {
        logger.info(`[ADB] disconnect: ${serial}`);
        await runAdb(['disconnect', serial]);
        logger.info(`[ADB] disconnected: ${serial}`);
    }
}

/** Singleton ADB service instance. */
export const adbService = new AdbService();
