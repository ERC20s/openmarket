import { describe, it, expect, beforeEach, vi } from 'vitest'

// The handler does `new PrismaClient()` at module scope, so the client has to be
// replaced before the handler is imported. vi.mock is hoisted above the imports.
vi.mock('@prisma/client', async () => {
  const stub = await import('./helpers/prisma-stub')
  return { PrismaClient: stub.PrismaClientStub }
})

import type { NextApiRequest, NextApiResponse } from 'next'
import handler from '../pages/api/sellers/[id]'
import {
  resetPrismaStub,
  fixtureSellers,
  fixtureProductsNewestFirst,
  MISSING_SELLER_ID,
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

describe('GET /api/sellers/[id]', () => {
  it('returns 200 with the seller and only that seller products', async () => {
    const seller = fixtureSellers()[0]
    const expected = fixtureProductsNewestFirst().filter((p) => p.sellerId === seller.id)

    const req = mockReq(`/api/sellers/${seller.id}?page=1&size=20`) as NextApiRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    const body = res.body as any
    expect(body.seller).toMatchObject({ id: seller.id, name: seller.name })
    expect(Array.isArray(body.products)).toBe(true)
    expect(body.products.map((p: any) => p.id)).toEqual(expected.map((p) => p.id))
    expect(body.products.every((p: any) => p.sellerId === seller.id)).toBe(true)
    expect(body.total).toBe(expected.length)
    expect(body.page).toBe(1)
    expect(body.size).toBe(20)
  })

  it('paginates that seller products', async () => {
    const seller = fixtureSellers()[1]
    const expected = fixtureProductsNewestFirst().filter((p) => p.sellerId === seller.id)

    const req = mockReq(`/api/sellers/${seller.id}?page=2&size=5`) as NextApiRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    const body = res.body as any
    expect(body.products.map((p: any) => p.id)).toEqual(expected.slice(5, 10).map((p) => p.id))
    expect(body.total).toBe(expected.length)
  })

  it('returns 404 for an id that is not in the fixture', async () => {
    const req = mockReq(`/api/sellers/${MISSING_SELLER_ID}`) as NextApiRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.statusCode).toBe(404)
    expect(res.body as any).toHaveProperty('error')
  })

  it('returns 422 for a non-numeric id', async () => {
    const req = mockReq('/api/sellers/not-a-number') as NextApiRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.statusCode).toBe(422)
    expect(res.body as any).toHaveProperty('error')
  })

  it('returns 405 with Allow: GET for a POST', async () => {
    const req = mockReq('/api/sellers/1', 'POST') as NextApiRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.statusCode).toBe(405)
    expect(res.headers['Allow']).toBe('GET')
    expect(res.body as any).toHaveProperty('error')
  })
})
