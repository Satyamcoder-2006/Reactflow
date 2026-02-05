import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/prisma';
import { EmulatorService } from '../services/emulator.service';
import { MetroService } from '../services/metro.service';
import { ShellService } from '../services/shell.service';
import { StorageService } from '../services/storage.service';

const emulatorService = new EmulatorService();
const metroService = new MetroService();
const storageService = new StorageService();
const shellService = new ShellService(storageService);

export async function sessionRoutes(app: FastifyInstance) {
    // Create emulator session
    app.post<{
        Body: { repoId: string };
    }>('/', async (request, reply) => {
        const { repoId } = request.body;
        const userId = (request.user as any)?.id;

        // Verify repo ownership
        const repo = await prisma.repo.findFirst({
            where: { id: repoId, userId },
        });

        if (!repo) {
            return reply.code(404).send({ error: 'Repository not found' });
        }

        // Get current shell
        const shell = await shellService.getCurrentShell(repoId);
        if (!shell) {
            return reply.code(400).send({ error: 'No shell APK available. Build in progress?' });
        }

        // Ensure Metro is running
        const metroUrl = await metroService.getMetroUrl(repoId);
        if (!metroUrl) {
            // Start Metro
            await metroService.startMetro(repoId, `/repos/${repo.fullName}`);
        }

        // Create session
        const session = await emulatorService.createSession({
            repoId,
            userId,
            shellId: shell.id,
            shellApkUrl: shell.apkUrl,
        });

        return { session };
    });

    // Get session details
    app.get<{
        Params: { id: string };
    }>('/:id', async (request, reply) => {
        const { id } = request.params;

        const session = await prisma.emulatorSession.findUnique({
            where: { id },
            include: {
                repo: true,
                shell: true,
                metro: true,
            },
        });

        if (!session) {
            return reply.code(404).send({ error: 'Session not found' });
        }

        return { session };
    });

    // Stop session
    app.delete<{
        Params: { id: string };
    }>('/:id', async (request, reply) => {
        const { id } = request.params;

        await emulatorService.stopSession(id);

        return { success: true };
    });

    // Send input to emulator
    app.post<{
        Params: { id: string };
        Body: {
            type: 'tap' | 'swipe' | 'key' | 'text';
            x?: number;
            y?: number;
            x2?: number;
            y2?: number;
            key?: string;
            text?: string;
        };
    }>('/:id/input', async (request, reply) => {
        const { id } = request.params;
        const input = request.body;

        await emulatorService.sendInput(id, input);

        return { success: true };
    });

    // Trigger reload
    app.post<{
        Params: { id: string };
    }>('/:id/reload', async (request, reply) => {
        const { id } = request.params;

        await emulatorService.reloadSession(id);

        return { success: true };
    });
}
