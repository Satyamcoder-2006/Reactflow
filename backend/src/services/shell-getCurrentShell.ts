import { ShellService } from './shell.service';
import { StorageService } from './storage.service';

export class ShellService {
    // ... existing code ...

    /**
     * Get current shell for repository
     */
    async getCurrentShell(repoId: string) {
        const link = await this.prisma.repoShell.findFirst({
            where: { repoId, isCurrent: true },
            include: { shell: true },
        });

        return link?.shell || null;
    }
}
