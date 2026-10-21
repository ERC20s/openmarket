import { PrismaClient } from '@prisma/client'

import { hashToken, newToken } from '../lib/auth'

// Issue (or rotate) one seller's API token: npm run seller:token -- <sellerId>
// The token is printed once and only its SHA-256 is stored; running this again
// replaces it, so a leaked token is revoked by issuing a new one.

const prisma = new PrismaClient()

async function main() {
  const raw = process.argv[2] ?? ''
  const id = /^\d{1,10}$/.test(raw) ? Number(raw) : NaN
  if (!Number.isSafeInteger(id) || id < 1) {
    console.error('Usage: npm run seller:token -- <sellerId>')
    process.exit(2)
  }

  const token = newToken()
  const seller = await prisma.seller.update({
    where: { id },
    data: { apiTokenHash: hashToken(token) },
    select: { id: true, name: true },
  })
  console.log(`API token for seller #${seller.id} (${seller.name}) - shown once, send it as "Authorization: Bearer <token>":`)
  console.log(token)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
