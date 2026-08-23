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
