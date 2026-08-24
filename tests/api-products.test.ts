import { describe, it, expect, beforeAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import faker from 'faker'
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
  // ensure a minimal set of products exist so tests can run in CI without manual seeding
  const count = await prisma.product.count()
  if (count < 20) {
    // find or create a seller to attach products to
    let seller = await prisma.seller.findFirst()
    if (!seller) {
      seller = await prisma.seller.create({
        data: { name: faker.company.companyName(), email: faker.internet.email() },
      })
    }

    const toCreate = 20 - count
    for (let i = 0; i < toCreate; i++) {
      await prisma.product.create({
        data: {
          title: faker.commerce.productName(),
          description: faker.commerce.productDescription(),
          price_cents: Math.round(parseFloat(faker.commerce.price(1, 1000)) * 100),
          sellerId: seller.id,
        },
      })
    }
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
