/**
 * Schema for triggering a build (RESTful Option A)
 */
export const createBuildSchema = {
    params: {
        type: 'object',
        required: ['repoId'],
        properties: {
            repoId: { type: 'string', pattern: '^[a-zA-Z0-9_-]+$' },
        },
    },
    body: {
        type: 'object',
        properties: {
            branch: {
                type: 'string',
                default: 'main',
                pattern: '^[a-zA-Z0-9/_.-]+$',
                maxLength: 255
            },
            autoStartSession: { type: 'boolean', default: false },
            emulatorConfig: {
                type: 'object',
                properties: {
                    deviceType: { type: 'string', enum: ['phone', 'tablet'], default: 'phone' },
                    androidVersion: { type: 'integer', minimum: 28, maximum: 35, default: 33 },
                    screenDensity: {
                        type: 'string',
                        enum: ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'],
                        default: 'xhdpi'
                    }
                },
                additionalProperties: false
            }
        },
        additionalProperties: false,
    },
};

/**
 * Schema for getting build lists per repository
 */
export const listBuildsSchema = {
    params: {
        type: 'object',
        required: ['repoId'],
        properties: {
            repoId: { type: 'string', minLength: 1 },
        },
    },
};

/**
 * Schema for build-specific operations
 */
export const buildDetailSchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: {
            id: { type: 'string', minLength: 1 },
        },
    },
};
