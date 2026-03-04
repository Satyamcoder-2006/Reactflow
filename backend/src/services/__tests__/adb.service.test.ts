import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

// ── Mock child_process.spawn ──────────────────────────────────────────────────

vi.mock('child_process', () => ({
    spawn: vi.fn(),
}));

// ── Mock env ─────────────────────────────────────────────────────────────────

vi.mock('../../config/env', () => ({
    env: {
        ADB_PATH: 'adb',
    },
}));

// ── Mock logger ───────────────────────────────────────────────────────────────

vi.mock('../../utils/logger', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

// ── Helper: build a fake spawn process ───────────────────────────────────────

function makeProcess(stdoutData: string, exitCode: number = 0): ChildProcess {
    const proc = new EventEmitter() as unknown as ChildProcess;
    (proc as any).stdout = new EventEmitter();
    (proc as any).stderr = new EventEmitter();

    setTimeout(() => {
        (proc as any).stdout.emit('data', Buffer.from(stdoutData));
        proc.emit('close', exitCode);
    }, 0);

    return proc;
}

// ── Import after mocks are set up ─────────────────────────────────────────────

import { spawn } from 'child_process';
import { AdbService, AdbError } from '../adb.service';

const spawnMock = vi.mocked(spawn);

describe('AdbService', () => {
    let adb: AdbService;

    beforeEach(() => {
        vi.clearAllMocks();
        adb = new AdbService();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ── connect() ─────────────────────────────────────────────────────────────

    describe('connect()', () => {
        it('succeeds on first attempt when stdout contains "connected"', async () => {
            spawnMock.mockReturnValueOnce(makeProcess('connected to 192.168.1.1:5555'));

            const serial = await adb.connect('192.168.1.1', 5555);

            expect(serial).toBe('192.168.1.1:5555');
            expect(spawnMock).toHaveBeenCalledTimes(1);
        });

        it('succeeds on third attempt after two failures', async () => {
            spawnMock
                .mockReturnValueOnce(makeProcess('connection refused'))
                .mockReturnValueOnce(makeProcess('failed to connect'))
                .mockReturnValueOnce(makeProcess('connected to 10.0.0.1:5555'));

            const serial = await adb.connect('10.0.0.1', 5555);

            expect(serial).toBe('10.0.0.1:5555');
            expect(spawnMock).toHaveBeenCalledTimes(3);
        }, 20_000); // allow retry delays in test (mocked sleep isn't instant)

        it('rejects with AdbError after 3 consecutive failures', async () => {
            spawnMock
                .mockReturnValueOnce(makeProcess('connection refused'))
                .mockReturnValueOnce(makeProcess('connection refused'))
                .mockReturnValueOnce(makeProcess('connection refused'));

            await expect(adb.connect('bad.host', 5555)).rejects.toBeInstanceOf(AdbError);
            expect(spawnMock).toHaveBeenCalledTimes(3);
        }, 20_000);
    });

    // ── waitForBoot() ─────────────────────────────────────────────────────────

    describe('waitForBoot()', () => {
        it('resolves when getprop returns "1" on the third poll', async () => {
            spawnMock
                .mockReturnValueOnce(makeProcess(''))       // poll 1 — empty string (early boot)
                .mockReturnValueOnce(makeProcess(''))       // poll 2 — still empty
                .mockReturnValueOnce(makeProcess('1\n'));   // poll 3 — booted

            await expect(adb.waitForBoot('emulator-5554', 60_000)).resolves.toBeUndefined();
            expect(spawnMock).toHaveBeenCalledTimes(3);
        });

        it('rejects with AdbError when timeout is exceeded', async () => {
            // Always return empty — simulates never booting
            spawnMock.mockImplementation(() => makeProcess(''));

            await expect(adb.waitForBoot('emulator-5554', 100 /* 100ms timeout */))
                .rejects.toBeInstanceOf(AdbError);
        });
    });

    // ── install() ─────────────────────────────────────────────────────────────

    describe('install()', () => {
        it('resolves when stdout last line contains "Success"', async () => {
            spawnMock.mockReturnValueOnce(makeProcess('Performing Streamed Install\nSuccess\n'));
            await expect(adb.install('emulator-5554', '/tmp/app.apk')).resolves.toBeUndefined();
        });

        it('rejects with parsed error code on INSTALL_FAILED_VERSION_DOWNGRADE — then retries with -d', async () => {
            // First call fails with downgrade error
            spawnMock.mockReturnValueOnce(makeProcess('Failure [INSTALL_FAILED_VERSION_DOWNGRADE]'));
            // Retry with -d succeeds
            spawnMock.mockReturnValueOnce(makeProcess('Success'));

            await expect(adb.install('emulator-5554', '/tmp/app.apk')).resolves.toBeUndefined();
            expect(spawnMock).toHaveBeenCalledTimes(2);
            // Second call must include the -d flag
            const secondCallArgs = spawnMock.mock.calls[1][1] as string[];
            expect(secondCallArgs).toContain('-d');
        });

        it('rejects with AdbError containing the failure code', async () => {
            spawnMock.mockReturnValueOnce(makeProcess('Failure [INSTALL_PARSE_FAILED_NO_CERTIFICATES]'));

            await expect(adb.install('emulator-5554', '/tmp/bad.apk'))
                .rejects.toMatchObject({
                    code: 'INSTALL_PARSE_FAILED_NO_CERTIFICATES',
                });
        });
    });

    // ── checkAppRunning() ─────────────────────────────────────────────────────

    describe('checkAppRunning()', () => {
        it('returns true when pidof outputs a numeric PID', async () => {
            spawnMock.mockReturnValueOnce(makeProcess('12345\n'));
            const result = await adb.checkAppRunning('emulator-5554', 'com.myapp');
            expect(result).toBe(true);
        });

        it('returns false when pidof output is empty', async () => {
            spawnMock.mockReturnValueOnce(makeProcess(''));
            const result = await adb.checkAppRunning('emulator-5554', 'com.ghost');
            expect(result).toBe(false);
        });
    });

    // ── getDeviceList() ───────────────────────────────────────────────────────

    describe('getDeviceList()', () => {
        it('parses "adb devices" output and excludes offline devices', async () => {
            const output = [
                'List of devices attached',
                '192.168.0.10:5555\tdevice',
                'emulator-5554\toffline',
                'emulator-5556\tdevice',
            ].join('\n');

            spawnMock.mockReturnValueOnce(makeProcess(output));

            const devices = await adb.getDeviceList();
            expect(devices).toContain('192.168.0.10:5555');
            expect(devices).toContain('emulator-5556');
            expect(devices).not.toContain('emulator-5554'); // offline
        });
    });
});
