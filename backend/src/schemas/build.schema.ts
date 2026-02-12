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
            branch: { type: 'string', default: 'main', pattern: '^[a-zA-Z0-9/_-]+$' },
            buildType: { type: 'string', enum: ['SHELL', 'HOT_RELOAD'], default: 'SHELL' },
            autoStartSession: { type: 'boolean', default: false },
            emulatorConfig: {
                type: 'object',
                properties: {
                    deviceType: { type: 'string', enum: ['phone', 'tablet'], default: 'phone' },
                    androidVersion: { type: 'number', minimum: 28, maximum: 34, default: 33 },
                }
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
