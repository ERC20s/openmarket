import { describe, it, expect, vi } from 'vitest'

import { PRODUCT_COUNT, SELLER_COUNT, seedDatabase, type SeedClient } from '../prisma/seed-data'

// A client whose two models are spies: count answers what the test says the
// database holds, create hands back a row with the next id.
type ProductData = { title: string; description: string; price_cents: number; sellerId: number }

function client(counts: { sellers: number; products: number }) {
  let nextSellerId = 1
  let created = 0
  const seller = {
    count: vi.fn(async () => counts.sellers),
    create: vi.fn(async (args: { data: { name: string; email: string } }) => ({ id: nextSellerId++, ...args.data })),
  }
  const product = {
    count: vi.fn(async () => counts.products + created),
    create: vi.fn(async (_args: { data: ProductData }) => {
      created += 1
      return {}
    }),
  }
  const prisma: SeedClient = { seller, product }
  return { seller, product, prisma }
}

describe('seedDatabase', () => {
  it('fills an empty database with 10 sellers and 500 products spread evenly across them', async () => {
    const { seller, product, prisma } = client({ sellers: 0, products: 0 })

    const result = await seedDatabase(prisma)

    expect(result).toEqual({ seeded: true, sellers: SELLER_COUNT, products: PRODUCT_COUNT })
    expect(seller.create).toHaveBeenCalledTimes(SELLER_COUNT)
    expect(product.create).toHaveBeenCalledTimes(PRODUCT_COUNT)

    const perSeller = new Map<number, number>()
    for (const [args] of product.create.mock.calls) {
      expect(args.data.sellerId).toBeGreaterThanOrEqual(1)
      expect(args.data.sellerId).toBeLessThanOrEqual(SELLER_COUNT)
      expect(Number.isInteger(args.data.price_cents)).toBe(true)
      expect(args.data.price_cents).toBeGreaterThanOrEqual(100)
      expect(args.data.title).not.toBe('')
      perSeller.set(args.data.sellerId, (perSeller.get(args.data.sellerId) ?? 0) + 1)
    }
    expect([...perSeller.values()]).toEqual(Array(SELLER_COUNT).fill(PRODUCT_COUNT / SELLER_COUNT))
  })

  it('writes nothing to a database that is already seeded, and says what it holds', async () => {
    const { seller, product, prisma } = client({ sellers: 10, products: 500 })

    const result = await seedDatabase(prisma)

    expect(result).toEqual({ seeded: false, sellers: 10, products: 500 })
    expect(seller.create).not.toHaveBeenCalled()
    expect(product.create).not.toHaveBeenCalled()
  })

  it('writes nothing when only one of the two tables has rows', async () => {
    const sellersOnly = client({ sellers: 3, products: 0 })
    expect((await seedDatabase(sellersOnly.prisma)).seeded).toBe(false)
    expect(sellersOnly.seller.create).not.toHaveBeenCalled()
    expect(sellersOnly.product.create).not.toHaveBeenCalled()

    const productsOnly = client({ sellers: 0, products: 7 })
    expect((await seedDatabase(productsOnly.prisma)).seeded).toBe(false)
    expect(productsOnly.seller.create).not.toHaveBeenCalled()
    expect(productsOnly.product.create).not.toHaveBeenCalled()
  })
})
