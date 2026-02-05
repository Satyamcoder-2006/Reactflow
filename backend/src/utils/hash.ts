import crypto from 'crypto';

/**
 * Generate SHA-256 hash from object
 */
export function generateHash(data: any): string {
    const normalized = JSON.stringify(data, Object.keys(data).sort());
    return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Generate dependency hash for Shell APK caching
 */
export function generateDependencyHash(packageJson: any): string {
    const nativeDeps = extractNativeDependencies(packageJson);

    const hashInput = {
        reactNativeVersion: packageJson.dependencies?.['react-native'],
        expoVersion: packageJson.dependencies?.['expo'],
        dependencies: nativeDeps,
    };

    return generateHash(hashInput);
}

/**
 * Extract dependencies that have native code
 */
export function extractNativeDependencies(packageJson: any): Record<string, string> {
    const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
    };

    // Patterns for known native modules
    const nativeModulePatterns = [
        'react-native-',
        '@react-native',
        'expo-',
        '@react-navigation/native',
        '@react-navigation/stack',
        '@react-navigation/bottom-tabs',
        'react-native-reanimated',
        'react-native-gesture-handler',
        'react-native-screens',
        'react-native-safe-area-context',
        '@shopify/flash-list',
    ];

    const nativeDeps: Record<string, string> = {};

    for (const [name, version] of Object.entries(allDeps)) {
        if (
            nativeModulePatterns.some((pattern) => (name as string).startsWith(pattern))
        ) {
            nativeDeps[name] = version as string;
        }
    }

    return nativeDeps;
}
