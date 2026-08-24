import { describe, it, expect, beforeAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import faker from 'faker'
import { NextApiRequest, NextApiResponse } from 'next'
import handler from '../pages/api/products/[id]'

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
  const count = await prisma.product.count()
  if (count < 1) {
    // create a minimal seller and product so tests can run without the full seed
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
  }
})

describe('GET /api/products/[id]', () => {
  it('returns 200 and product shape for an existing id', async () => {
    const anyProduct = await prisma.product.findFirst()
    if (!anyProduct) {
      throw new Error('No product in DB for test')
    }

    const req = mockReq(`/api/products/${anyProduct.id}`) as NextApiRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    const body = res.body as any
    expect(body).toHaveProperty('id', anyProduct.id)
    expect(body).toHaveProperty('title')
    expect(body).toHaveProperty('description')
    expect(body).toHaveProperty('price_cents')
    expect(body).toHaveProperty('seller')
    expect(body.seller).toHaveProperty('id')
    expect(body.seller).toHaveProperty('name')
  })

  it('returns 404 for a non-existent id', async () => {
    // choose a large id that's unlikely to exist
    const req = mockReq('/api/products/99999999') as NextApiRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.statusCode).toBe(404)
    const body = res.body as any
    expect(body).toHaveProperty('error')
  })
})
