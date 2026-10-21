import faker from 'faker'

// What `npm run prisma:seed` writes, as a function of the client it is handed,
// so the decision "is there anything to do?" is unit-tested without a database
// (tests/seed.test.ts) while prisma/seed.ts stays the thin script the setup
// entry runs.
//
// The seed only ever runs against an empty database. The setup entry in .d8a
// (generate, migrate, seed) is launched by the ▶ button every time, and a seed
// that inserted unconditionally doubled the sellers and products on each run:
// 10 and 500 after the first, 20 and 1,000 after the second. Delete
// prisma/dev.db and run setup again for a fresh catalogue.

export const SELLER_COUNT = 10
export const PRODUCT_COUNT = 500

/** The two models the seed touches, in the shape both PrismaClient and a spy satisfy. */
export type SeedClient = {
  seller: {
    count(): Promise<number>
    create(args: { data: { name: string; email: string } }): Promise<{ id: number }>
  }
  product: {
    count(): Promise<number>
    create(args: {
      data: { title: string; description: string; price_cents: number; sellerId: number }
    }): Promise<unknown>
  }
}

export type SeedResult = {
  /** False when the database already held rows and nothing was written. */
  seeded: boolean
  sellers: number
  products: number
}

export async function seedDatabase(prisma: SeedClient): Promise<SeedResult> {
  const [sellers, products] = await Promise.all([prisma.seller.count(), prisma.product.count()])
  if (sellers > 0 || products > 0) {
    return { seeded: false, sellers, products }
  }

  const created: { id: number }[] = []
  for (let i = 0; i < SELLER_COUNT; i++) {
    const seller = await prisma.seller.create({
      data: {
        name: faker.company.companyName(),
        email: faker.internet.email(),
      },
    })
    created.push(seller)
  }

  for (let i = 0; i < PRODUCT_COUNT; i++) {
    const seller = created[i % created.length]
    await prisma.product.create({
      data: {
        title: faker.commerce.productName(),
        description: faker.commerce.productDescription(),
        price_cents: Math.round(parseFloat(faker.commerce.price(1, 1000)) * 100),
        sellerId: seller.id,
      },
    })
  }

  return { seeded: true, sellers: created.length, products: await prisma.product.count() }
}
