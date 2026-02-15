import { prisma } from './src/db/prisma';
async function main() {
    const session = await prisma.emulatorSession.findUnique({
        where: { id: 'cmlnblj8100019h3alctz3kl4' }
    });
    console.log(JSON.stringify(session, null, 2));
}
main().finally(() => prisma.$disconnect());
