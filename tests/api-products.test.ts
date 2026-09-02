import { describe, it, expect, beforeEach, vi } from 'vitest'

// The handler does `new PrismaClient()` at module scope, so the client has to be
// replaced before the handler is imported. vi.mock is hoisted above the imports.
vi.mock('@prisma/client', async () => {
  const stub = await import('./helpers/prisma-stub')
  return { PrismaClient: stub.PrismaClientStub }
})

import type { NextApiRequest, NextApiResponse } from 'next'
import handler from '../pages/api/products'
import {
  resetPrismaStub,
  fixtureProductsNewestFirst,
  FIXTURE_PRODUCT_COUNT,
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

describe('GET /api/products pagination', () => {
  it('returns the first 20 fixture products for page=1&size=20', async () => {
    const req = mockReq('/api/products?page=1&size=20') as NextApiRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    const body = res.body as any
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items.length).toBe(20)
    expect(body.total).toBe(FIXTURE_PRODUCT_COUNT)
    expect(body.page).toBe(1)
    expect(body.size).toBe(20)

    const expected = fixtureProductsNewestFirst().slice(0, 20).map((p) => p.id)
    expect(body.items.map((p: any) => p.id)).toEqual(expected)
    expect(body.items[0].seller).toMatchObject({ id: expect.any(Number), name: expect.any(String) })
  })

  it('returns the remainder on the last page', async () => {
    const req = mockReq('/api/products?page=2&size=20') as NextApiRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    const body = res.body as any
    expect(body.items.length).toBe(FIXTURE_PRODUCT_COUNT - 20)
    expect(body.items.map((p: any) => p.id)).toEqual(
      fixtureProductsNewestFirst().slice(20).map((p) => p.id),
    )
    expect(body.total).toBe(FIXTURE_PRODUCT_COUNT)
  })

  it('returns 422 for an out-of-range size', async () => {
    const req = mockReq('/api/products?page=1&size=500') as NextApiRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.statusCode).toBe(422)
    expect(res.body as any).toHaveProperty('error')
  })

  it('returns 422 for a non-numeric page', async () => {
    const req = mockReq('/api/products?page=abc') as NextApiRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.statusCode).toBe(422)
    expect(res.body as any).toHaveProperty('error')
  })
})
