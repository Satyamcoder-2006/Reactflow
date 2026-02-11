/**
 * Schema for triggering a build (RESTful Option A)
 */
export const createBuildSchema = {
    params: {
        type: 'object',
        required: ['repoId'],
        properties: {
            repoId: { type: 'string', minLength: 1 },
        },
    },
    body: {
        type: 'object',
        properties: {
            branch: { type: 'string', default: 'main' },
            buildType: { type: 'string', enum: ['SHELL', 'HOT_RELOAD'], default: 'SHELL' },
        },
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
