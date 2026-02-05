import { GitHubService } from './github.service';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';

export class ChangeDetectionService {
    constructor(private github: GitHubService) { }

    /**
     * Analyze changes between two commits
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
        const jsFiles = changedFiles.filter((file) => this.isJsFile(file) && !nativeFiles.includes(file));
        const assetFiles = changedFiles.filter((file) => this.isAssetFile(file) && !nativeFiles.includes(file));

        const hasNativeChanges = nativeFiles.length > 0;
        const hasJsChanges = jsFiles.length > 0 || assetFiles.length > 0;

        // Determine action
        let actionTaken: string;
        if (hasNativeChanges) {
            actionTaken = 'SHELL_REBUILD';
            logger.info(`🔨 Native changes detected → Full rebuild required`);
        } else if (hasJsChanges) {
            actionTaken = 'HOT_RELOAD';
            logger.info(`⚡ JS-only changes detected → Hot reload`);
        } else {
            actionTaken = 'NO_ACTION';
            logger.info(`ℹ️ No relevant changes detected`);
        }

        // Save analysis
        const analysis = await prisma.changeAnalysis.create({
            data: {
                repoId,
                beforeCommit,
                afterCommit,
                hasNativeChanges,
                hasJsChanges,
                hasAssetChanges: assetFiles.length > 0,
                changedFiles,
                nativeFiles,
                jsFiles,
                actionTaken,
            },
        });

        logger.info(`Change analysis saved: ${analysis.id}`);

        return {
            hasNativeChanges,
            hasJsChanges,
            actionTaken,
            changedFiles,
            nativeFiles,
            jsFiles,
            assetFiles,
        };
    }

    /**
     * Check if file is a native file that requires rebuild
     */
    private isNativeFile(filePath: string): boolean {
        const nativePatterns = [
            /^android\//,
            /^ios\//,
            /^package\.json$/,
            /^package-lock\.json$/,
            /^yarn\.lock$/,
            /^pnpm-lock\.yaml$/,
            /^app\.json$/,
            /^app\.config\.(js|ts)$/,
            /^metro\.config\.js$/,
            /^babel\.config\.js$/,
            /\.gradle$/,
            /\.pbxproj$/,
            /Podfile$/,
        ];

        return nativePatterns.some((pattern) => pattern.test(filePath));
    }

    /**
     * Check if file is a JavaScript file
     */
    private isJsFile(filePath: string): boolean {
        return /\.(js|jsx|ts|tsx)$/.test(filePath);
    }

    /**
     * Check if file is an asset file
     */
    private isAssetFile(filePath: string): boolean {
        return /\.(png|jpg|jpeg|gif|svg|webp|ttf|otf|mp4|mp3|wav|json)$/.test(filePath);
    }
}
