import { PrismaClient } from '@prisma/client'
import faker from 'faker'

const prisma = new PrismaClient()

async function main() {
  // create 10 sellers
  const sellers = []
  for (let i = 0; i < 10; i++) {
    const s = await prisma.seller.create({
      data: {
        name: faker.company.companyName(),
        email: faker.internet.email(),
      },
    })
    sellers.push(s)
  }

  const total = 500
  const batch = 50
  for (let i = 0; i < total; i++) {
    const seller = sellers[i % sellers.length]
    await prisma.product.create({
      data: {
        title: faker.commerce.productName(),
        description: faker.commerce.productDescription(),
        price_cents: Math.round(parseFloat(faker.commerce.price(1, 1000)) * 100),
        sellerId: seller.id,
      },
    })
  }

  const count = await prisma.product.count()
  console.log(`Seeded ${count} products`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
