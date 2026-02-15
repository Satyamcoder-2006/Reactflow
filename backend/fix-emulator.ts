import { PrismaClient } from '@prisma/client';
import { DockerService } from './src/services/docker.service';
import { logger } from './src/utils/logger';

const prisma = new PrismaClient();
const docker = new DockerService();

async function waitForBoot(containerId: string) {
    logger.info('Waiting for Android to boot...');

    const maxWaitTime = 120000; // 2 minutes
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
        try {
            const result = await docker.execInContainer(containerId, [
                'sh', '-c', 'getprop sys.boot_completed'
            ]);

            console.log(`Boot status: "${result.trim()}"`);

            if (result.trim() === '1') {
                logger.info('✅ Android has booted!');
                return true;
            }
        } catch (error: any) {
            console.log(`Check failed: ${error.message}`);
        }

        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    throw new Error('Boot timeout after 2 minutes');
}

async function installAndLaunchApk(containerId: string, apkUrl: string) {
    try {
        logger.info(`Installing APK from ${apkUrl}...`);

        // The APK URL is like: /storage/shells/cmlkay899cc050da15/shell.apk
        const apkPath = apkUrl.replace(/^.*?(\/storage\/.+)$/, '$1');

        const installResult = await docker.execInContainer(containerId, [
            'sh', '-c', `pm install -r ${apkPath}`
        ]);

        logger.info(`Install result: ${installResult}`);

        // List newly installed packages
        const packages = await docker.execInContainer(containerId, [
            'sh', '-c', 'pm list packages -3'
        ]);

        console.log('Installed packages:', packages);

        // Try common package names for React Native/Expo
        const possiblePackages = ['com.anonymous', 'com.reactnativeapp', 'host.exp.exponent'];

        let packageName = packages.split('\\n').find((p: string) =>
            possiblePackages.some(name => p.includes(name))
        );

        if (packageName) {
            packageName = packageName.replace('package:', '').trim();
        } else {
            // Get the first third-party package
            const firstPackage = packages.split('\\n')[0];
            packageName = firstPackage.replace('package:', '').trim();
        }

        if (!packageName) {
            throw new Error('No third-party packages found');
        }

        logger.info(`Package name: ${packageName}`);
        logger.info('Launching app...');

        await docker.execInContainer(containerId, [
            'sh', '-c', `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`
        ]);

        logger.info('✅ App launched successfully!');
        return packageName;

    } catch (error) {
        logger.error(`Installation/launch failed: ${error}`);
        throw error;
    }
}

async function main() {
    try {
        // Find running emulator session
        const session = await prisma.emulatorSession.findFirst({
            where: { status: { in: ['STARTING', 'RUNNING'] } },
            orderBy: { startedAt: 'desc' }
        });

        if (!session) {
            console.error('No running emulator session found');
            return;
        }

        logger.info(`Found session: ${session.id}`);
        logger.info(`Container: ${session.containerId.substring(0, 12)}`);

        // Get APK URL from environment
        const envVars = await docker.docker.getContainer(session.containerId).inspect();
        const shellApkUrl = envVars.Config.Env.find((e: string) => e.startsWith('SHELL_APK_URL='))
            ?.split('=')[1];

        if (!shellApkUrl) {
            throw new Error('SHELL_APK_URL not found in container environment');
        }

        logger.info(`APK URL: ${shellApkUrl}`);

        await waitForBoot(session.containerId);
        const packageName = await installAndLaunchApk(session.containerId, shellApkUrl);

        // Update session status
        await prisma.emulatorSession.update({
            where: { id: session.id },
            data: { status: 'RUNNING' }
        });

        logger.info(`🎉 Emulator is now ready! Package: ${packageName}`);

    } catch (error) {
        logger.error(`Failed: ${error}`);
    } finally {
        await prisma.$disconnect();
    }
}

main();
