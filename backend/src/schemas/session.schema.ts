/**
 * Schema for starting an emulator session
 */
export const startSessionSchema = {
    body: {
        type: 'object',
        required: ['repoId'],
        properties: {
            repoId: { type: 'string', minLength: 1 },
            shellId: { type: 'string' },
            emulatorConfig: {
                type: 'object',
                properties: {
                    deviceType: { type: 'string', enum: ['phone', 'tablet'], default: 'phone' },
                    androidVersion: { type: 'number', minimum: 28, maximum: 34, default: 34 }
                }
            }
        },
    },
};

/**
 * Schema for session-specific operations
 */
export const sessionParamsSchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: {
            id: { type: 'string', minLength: 1 },
        },
    },
};
