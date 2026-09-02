import { describe, it, expect, beforeAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import faker from 'faker'
import { NextApiRequest, NextApiResponse } from 'next'
import handler from '../pages/api/sellers/[id]'

const prisma = new PrismaClient()

function mockReq(url: string, method = 'GET'): Partial<NextApiRequest> {
  return {
    url,
    method,
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
  res.setHeader = (name: string, value: string) => {
    // no-op for tests
  }
  return res as NextApiResponse
}

beforeAll(async () => {
  const count = await prisma.seller.count()
  if (count < 1) {
    // create a seller with at least one product so tests can run without the full seed
    const seller = await prisma.seller.create({
      data: { name: faker.company.companyName(), email: faker.internet.email() },
    })
    await prisma.product.create({
      data: {
        title: faker.commerce.productName(),
        description: faker.commerce.productDescription(),
        price_cents: Math.round(parseFloat(faker.commerce.price(1, 1000)) * 100),
        sellerId: seller.id,
      },
    })
  } else {
    // ensure at least one seller has a product
    const sellerWithProduct = await prisma.seller.findFirst({ where: { products: { some: {} } } })
    if (!sellerWithProduct) {
      const seller = await prisma.seller.findFirst()
      if (seller) {
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
  }
})

describe('GET /api/sellers/[id]', () => {
  it('returns 200 and seller with products for an existing id', async () => {
    const anySeller = await prisma.seller.findFirst()
    if (!anySeller) {
      throw new Error('No seller in DB for test')
    }

    const req = mockReq(`/api/sellers/${anySeller.id}`) as NextApiRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    const body = res.body as any
    expect(body).toHaveProperty('seller')
    expect(body.seller).toHaveProperty('id', anySeller.id)
    expect(body.seller).toHaveProperty('name')
    expect(body).toHaveProperty('products')
    expect(Array.isArray(body.products)).toBe(true)
  })

  it('returns 404 for a non-existent id', async () => {
    const req = mockReq('/api/sellers/99999999') as NextApiRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.statusCode).toBe(404)
    const body = res.body as any
    expect(body).toHaveProperty('error')
  })
})

describe('id validation on /api/sellers/[id]', () => {
  it('returns 422 for a trailing-garbage id like 9abc', async () => {
    const req = mockReq('/api/sellers/9abc') as NextApiRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.statusCode).toBe(422)
    expect(res.body as any).toHaveProperty('error', 'Invalid id')
  })

  it('returns 422 for a decimal id like 9.7', async () => {
    const req = mockReq('/api/sellers/9.7') as NextApiRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.statusCode).toBe(422)
  })

  it('returns 422 for zero and for a negative id', async () => {
    for (const bad of ['0', '-1']) {
      const req = mockReq(`/api/sellers/${bad}`) as NextApiRequest
      const res = mockRes()

      await handler(req, res)

      expect(res.statusCode).toBe(422)
    }
  })

  it('returns 405 for a POST, even with a malformed id', async () => {
    const req = mockReq('/api/sellers/9abc', 'POST') as NextApiRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.statusCode).toBe(405)
    expect(res.body as any).toHaveProperty('error')
  })
})
