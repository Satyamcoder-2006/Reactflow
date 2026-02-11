import { Prisma } from '@prisma/client';

export class AppError extends Error {
    constructor(
        public statusCode: number,
        message: string,
        public code: string = 'INTERNAL_ERROR'
    ) {
        super(message);
        this.name = 'AppError';
    }
}

/**
 * Maps Prisma error codes to HTTP responses
 */
export function handlePrismaError(error: any): AppError {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        switch (error.code) {
            case 'P2002':
                return new AppError(409, `Conflict: Field ${error.meta?.target} already exists`, 'CONFLICT');
            case 'P2003':
                return new AppError(400, 'Foreign key constraint failed', 'INVALID_REFERENCE');
            case 'P2025':
                return new AppError(404, 'The requested resource was not found', 'NOT_FOUND');
            case 'P2021':
                return new AppError(500, 'Database table does not exist', 'DB_SCHEMA_ERROR');
            default:
                return new AppError(400, `Database error: ${error.message}`, 'DB_ERROR');
        }
    }

    if (error instanceof AppError) {
        return error;
    }

    return new AppError(500, error.message || 'An unexpected error occurred');
}
