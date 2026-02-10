const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const repo = await prisma.repository.findFirst();
    if (repo) {
        console.log(`Found Repo: ${repo.fullName} (ID: ${repo.id})`);
    } else {
        console.log('No repositories found in database.');
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
