import { describe, it, expect, beforeEach, vi } from 'vitest'

// The handler does `new PrismaClient()` at module scope, so the client has to be
// replaced before the handler is imported. vi.mock is hoisted above the imports.
vi.mock('@prisma/client', async () => {
  const stub = await import('./helpers/prisma-stub')
  return { PrismaClient: stub.PrismaClientStub }
})

import type { NextApiRequest, NextApiResponse } from 'next'
import handler from '../pages/api/products/[id]'
import {
  resetPrismaStub,
  fixtureProductsNewestFirst,
  MISSING_PRODUCT_ID,
} from './helpers/prisma-stub'

function mockReq(url: string, method = 'GET'): Partial<NextApiRequest> {
  return {
    url,
    method,
    headers: { host: 'localhost' },
  }
}

type MockRes = NextApiResponse & { body?: any; headers: Record<string, string> }

function mockRes(): MockRes {
  const res: any = { headers: {} }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (body: any) => {
    res.body = body
    return res
  }
  res.setHeader = (name: string, value: string) => {
    res.headers[name] = value
    return res
  }
  return res as MockRes
}

beforeEach(() => {
  resetPrismaStub()
})

describe('GET /api/products/[id]', () => {
  it('returns 200 and the product with its seller for an existing id', async () => {
    const fixture = fixtureProductsNewestFirst()[0]

    const req = mockReq(`/api/products/${fixture.id}`) as NextApiRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    const body = res.body as any
    expect(body.id).toBe(fixture.id)
    expect(body.title).toBe(fixture.title)
    expect(body.description).toBe(fixture.description)
    expect(body.price_cents).toBe(fixture.price_cents)
    expect(body.seller).toMatchObject({ id: fixture.sellerId })
    expect(typeof body.seller.name).toBe('string')
  })

  it('returns 404 for an id that is not in the fixture', async () => {
    const req = mockReq(`/api/products/${MISSING_PRODUCT_ID}`) as NextApiRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.statusCode).toBe(404)
    expect(res.body as any).toHaveProperty('error')
  })

  it('returns 422 for a non-numeric id', async () => {
    const req = mockReq('/api/products/not-a-number') as NextApiRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.statusCode).toBe(422)
    expect(res.body as any).toHaveProperty('error')
  })

  it('returns 405 with Allow: GET for a POST', async () => {
    const req = mockReq('/api/products/1', 'POST') as NextApiRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.statusCode).toBe(405)
    expect(res.headers['Allow']).toBe('GET')
    expect(res.body as any).toHaveProperty('error')
  })
})
