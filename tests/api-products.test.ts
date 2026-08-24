import { describe, it, expect, beforeAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
// We will import the handler directly
import { NextApiRequest, NextApiResponse } from 'next'
import handler from '../pages/api/products'

const prisma = new PrismaClient()

function mockReq(url: string): Partial<NextApiRequest> {
  return {
    url,
    headers: { host: 'localhost' },
  }
}

function mockRes() {
  const res: Partial<NextApiResponse> = {}
  res.status = (code: number) => {
    res.statusCode = code
    return res as NextApiResponse
  }
  res.json = (body: any) => {
    res.body = body
    return res as NextApiResponse
  }
  return res as NextApiResponse
}

beforeAll(async () => {
  // assume database has been seeded by running prisma/seed.ts prior to tests
  const count = await prisma.product.count()
  if (count < 500) {
    console.warn('Less than 500 products in DB; tests expect seed to be run')
  }
})

describe('GET /api/products pagination', () => {
  it('returns 20 items for page=1&size=20', async () => {
    const req = mockReq('/api/products?page=1&size=20') as NextApiRequest
    const res = mockRes()

    await handler(req, res)
    expect(res.statusCode).toBe(200)
    const body = res.body as any
    expect(body).toHaveProperty('items')
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items.length).toBe(20)
    expect(body).toHaveProperty('total')
    expect(typeof body.total).toBe('number')
  })
})

describe('GET /api/products filters and search', () => {
  it('returns results matching a text query q', async () => {
    // pick a product from the DB to search for
    const target = await prisma.product.findFirst({})
    if (!target) {
      throw new Error('No product found in DB')
    }
    // take a substring of the title to search for
    const token = target.title.split(' ')[0]
    const q = encodeURIComponent(token)

    const req = mockReq(`/api/products?q=${q}&page=1&size=20`) as NextApiRequest
    const res = mockRes()

    await handler(req, res)
    expect(res.statusCode).toBe(200)
    const body = res.body as any
    expect(Array.isArray(body.items)).toBe(true)
    // expect at least one item and that the target is among them
    const ids = body.items.map((i: any) => i.id)
    expect(ids).toContain(target.id)
  })

  it('filters by sellerId and by price range', async () => {
    // pick a product to use its sellerId and price
    const target = await prisma.product.findFirst({})
    if (!target) throw new Error('No product found in DB')

    const sellerId = target.sellerId
    const price = target.price_cents

    // seller filter
    const reqSeller = mockReq(`/api/products?sellerId=${sellerId}&page=1&size=50`) as NextApiRequest
    const resSeller = mockRes()
    await handler(reqSeller, resSeller)
    expect(resSeller.statusCode).toBe(200)
    const bodySeller = resSeller.body as any
    expect(Array.isArray(bodySeller.items)).toBe(true)
    // all returned items should match sellerId
    for (const item of bodySeller.items) {
      expect(item.seller).toBeDefined()
      expect(item.seller.id).toBe(sellerId)
    }

    // price range filter: set min and max to the exact price to ensure inclusion
    const reqPrice = mockReq(`/api/products?min_price_cents=${price}&max_price_cents=${price}&page=1&size=50`) as NextApiRequest
    const resPrice = mockRes()
    await handler(reqPrice, resPrice)
    expect(resPrice.statusCode).toBe(200)
    const bodyPrice = resPrice.body as any
    expect(Array.isArray(bodyPrice.items)).toBe(true)
    const ids = bodyPrice.items.map((i: any) => i.id)
    expect(ids).toContain(target.id)
  })
})
