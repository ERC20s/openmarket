import { PrismaClient } from '@prisma/client'

import { seedDatabase } from './seed-data'

// npm run prisma:seed — the last step of the setup entry in .d8a. The work is
// in prisma/seed-data.ts; this file only wires it to a real client. It writes
// nothing when the database is already seeded, so running setup again (the ▶
// button does, every time) cannot double the catalogue.

const prisma = new PrismaClient()

async function main() {
  const result = await seedDatabase(prisma)
  if (result.seeded) {
    console.log(`Seeded ${result.products} products`)
  } else {
    console.log(
      `Database already holds ${result.sellers} sellers and ${result.products} products; nothing written. ` +
        'Delete prisma/dev.db and run setup again for a fresh seed.'
    )
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
