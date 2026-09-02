import { describe, it, expect, beforeAll } from 'vitest'
import faker from 'faker'
// We will import the handler directly
import { NextApiRequest, NextApiResponse } from 'next'
import handler from '../pages/api/products'
import prisma from '../lib/prisma'

function mockReq(url: string, method = 'GET'): Partial<NextApiRequest> {
  return {
    url,
    method,
    headers: { host: 'localhost' },
  }
}

function mockRes() {
  const res: Partial<NextApiResponse> & { headers: Record<string, string> } = {
    headers: {},
  } as any
  res.status = (code: number) => {
    res.statusCode = code
    return res as NextApiResponse
  }
  res.json = (body: any) => {
    res.body = body
    return res as NextApiResponse
  }
  res.setHeader = ((name: string, value: any) => {
    res.headers[name] = String(value)
    return res as NextApiResponse
  }) as NextApiResponse['setHeader']
  return res as NextApiResponse & { headers: Record<string, string> }
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

describe('/api/products method guard', () => {
  it('rejects POST with 405 and an Allow: GET header', async () => {
    const req = mockReq('/api/products', 'POST') as NextApiRequest
    const res = mockRes()

    await handler(req, res)
    expect(res.statusCode).toBe(405)
    expect(res.headers['Allow']).toBe('GET')
    expect((res.body as any).error).toBe('Method not allowed')
  })

  it('rejects DELETE with 405', async () => {
    const req = mockReq('/api/products?page=1&size=20', 'DELETE') as NextApiRequest
    const res = mockRes()

    await handler(req, res)
    expect(res.statusCode).toBe(405)
    expect(res.headers['Allow']).toBe('GET')
  })
})
