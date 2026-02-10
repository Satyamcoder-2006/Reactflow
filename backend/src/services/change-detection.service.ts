import { GitHubService } from './github.service';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';

/**
 * Expanded change types for more granular decision-making.
 */
export enum ChangeType {
    NATIVE_REBUILD = 'NATIVE_REBUILD',       // Full Gradle build (android/, ios/, etc.)
    DEPENDENCY_UPDATE = 'DEPENDENCY_UPDATE',  // package.json changes → npm install + possible rebuild
    METRO_RESTART = 'METRO_RESTART',          // metro.config.js, babel.config.js → restart Metro
    HOT_RELOAD = 'HOT_RELOAD',               // Pure JS/TS HMR
    ASSET_SYNC = 'ASSET_SYNC',               // Images, fonts → sync without rebuild
    NO_ACTION = 'NO_ACTION',                  // No relevant changes
}

export class ChangeDetectionService {
    constructor(private github: GitHubService) { }

    /**
     * Analyze changes between two commits and determine the appropriate action.
     */
    async analyzeChanges(
        repoId: string,
        owner: string,
        repo: string,
        beforeCommit: string,
        afterCommit: string
    ) {
        logger.info(`Analyzing changes: ${beforeCommit} → ${afterCommit}`);

        const comparison = await this.github.compareCommits(owner, repo, beforeCommit, afterCommit);

        const changedFiles = comparison.files?.map((f) => f.filename) || [];

        logger.info(`Changed files: ${changedFiles.length}`);

        // Categorize files
        const nativeFiles = changedFiles.filter((file) => this.isNativeFile(file));
        const dependencyFiles = changedFiles.filter((file) => this.isDependencyFile(file));
        const metroConfigFiles = changedFiles.filter((file) => this.isMetroConfigFile(file));
        const jsFiles = changedFiles.filter(
            (file) => this.isJsFile(file) && !nativeFiles.includes(file) && !metroConfigFiles.includes(file)
        );
        const assetFiles = changedFiles.filter(
            (file) => this.isAssetFile(file) && !nativeFiles.includes(file)
        );

        const hasNativeChanges = nativeFiles.length > 0;
        const hasDependencyChanges = dependencyFiles.length > 0;
        const hasMetroConfigChanges = metroConfigFiles.length > 0;
        const hasJsChanges = jsFiles.length > 0;
        const hasAssetChanges = assetFiles.length > 0;

        // Determine action (priority order: native > dependency > metro config > JS > asset)
        let actionTaken: ChangeType;
        if (hasNativeChanges) {
            actionTaken = ChangeType.NATIVE_REBUILD;
            logger.info(`🔨 Native changes detected → Full rebuild required`);
        } else if (hasDependencyChanges) {
            actionTaken = ChangeType.DEPENDENCY_UPDATE;
            logger.info(`📦 Dependency changes detected → npm install + possible rebuild`);
        } else if (hasMetroConfigChanges) {
            actionTaken = ChangeType.METRO_RESTART;
            logger.info(`⚙️ Metro config changes detected → Restart Metro`);
        } else if (hasJsChanges) {
            actionTaken = ChangeType.HOT_RELOAD;
            logger.info(`⚡ JS-only changes detected → Hot reload`);
        } else if (hasAssetChanges) {
            actionTaken = ChangeType.ASSET_SYNC;
            logger.info(`🖼️ Asset-only changes detected → Asset sync`);
        } else {
            actionTaken = ChangeType.NO_ACTION;
            logger.info(`ℹ️ No relevant changes detected`);
        }

        // Save analysis
        const analysis = await prisma.changeAnalysis.create({
            data: {
                repoId,
                beforeCommit,
                afterCommit,
                hasNativeChanges: hasNativeChanges || hasDependencyChanges,
                hasJsChanges: hasJsChanges || hasMetroConfigChanges,
                hasAssetChanges,
                changedFiles,
                nativeFiles: [...nativeFiles, ...dependencyFiles],
                jsFiles: [...jsFiles, ...metroConfigFiles],
                actionTaken,
            },
        });

        logger.info(`Change analysis saved: ${analysis.id}`);

        return {
            hasNativeChanges,
            hasDependencyChanges,
            hasMetroConfigChanges,
            hasJsChanges,
            hasAssetChanges,
            actionTaken,
            changedFiles,
            nativeFiles,
            dependencyFiles,
            metroConfigFiles,
            jsFiles,
            assetFiles,
        };
    }

    /**
     * Check if file is a native file that requires full rebuild.
     */
    private isNativeFile(filePath: string): boolean {
        const nativePatterns = [
            /^android\//,
            /^ios\//,
            /\.gradle$/,
            /\.pbxproj$/,
            /Podfile$/,
            /^app\.json$/,
            /^app\.config\.(js|ts)$/,
            /android\/gradle\.properties$/,
        ];

        return nativePatterns.some((pattern) => pattern.test(filePath));
    }

    /**
     * Check if file is a dependency file (may need rebuild).
     */
    private isDependencyFile(filePath: string): boolean {
        const depPatterns = [
            /^package\.json$/,
            /^package-lock\.json$/,
            /^yarn\.lock$/,
            /^pnpm-lock\.yaml$/,
        ];

        return depPatterns.some((pattern) => pattern.test(filePath));
    }

    /**
     * Check if file is a Metro/Babel config (needs Metro restart).
     */
    private isMetroConfigFile(filePath: string): boolean {
        const metroPatterns = [
            /^metro\.config\.(js|ts)$/,
            /^babel\.config\.(js|ts)$/,
            /^\.babelrc$/,
        ];

        return metroPatterns.some((pattern) => pattern.test(filePath));
    }

    /**
     * Check if file is a JavaScript/TypeScript file (hot reload).
     */
    private isJsFile(filePath: string): boolean {
        return /\.(js|jsx|ts|tsx)$/.test(filePath);
    }

    /**
     * Check if file is an asset file (sync without rebuild).
     */
    private isAssetFile(filePath: string): boolean {
        return /\.(png|jpg|jpeg|gif|svg|webp|ttf|otf|mp4|mp3|wav|json)$/.test(filePath);
    }
}
