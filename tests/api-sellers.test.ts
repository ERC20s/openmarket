import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Registered before the handler is imported: it builds its Prisma client at
// module scope. vi.mock is hoisted above these imports.
vi.mock('@prisma/client', async () => {
  const { PrismaClientMock } = await import('./helpers/prisma-mock')
  return { PrismaClient: PrismaClientMock }
})

import { prismaSpies, resetPrismaSpies, mockReq, mockRes } from './helpers/prisma-mock'
import handler, { MAX_SELLERS } from '../pages/api/sellers/index'

let errorSpy: any

beforeEach(() => {
  resetPrismaSpies()
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
})

// A row shaped the way the select returns it: id, name and the relation count.
function fakeSellerRow(overrides: Record<string, any> = {}) {
  return { id: 1, name: 'Acme', _count: { products: 2 }, ...overrides }
}

describe('GET /api/sellers', () => {
  it('returns { sellers, total } with the product count flattened', async () => {
    prismaSpies.seller.findMany.mockResolvedValue([
      fakeSellerRow({ id: 4, name: 'Acme', _count: { products: 3 } }),
      fakeSellerRow({ id: 2, name: 'Bodega', _count: { products: 0 } }),
    ])

    const res = mockRes()
    await handler(mockReq('/api/sellers'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      sellers: [
        { id: 4, name: 'Acme', productCount: 3 },
        { id: 2, name: 'Bodega', productCount: 0 },
      ],
      total: 2,
    })
  })

  it('orders by name, caps the list and never selects the seller email', async () => {
    const res = mockRes()
    await handler(mockReq('/api/sellers'), res)

    expect(prismaSpies.seller.findMany).toHaveBeenCalledWith({
      take: MAX_SELLERS,
      orderBy: { name: 'asc' },
      select: { id: true, name: true, _count: { select: { products: true } } },
    })

    const args = prismaSpies.seller.findMany.mock.calls[0][0]
    expect(args.select).not.toHaveProperty('email')
    expect(JSON.stringify(args)).not.toContain('email')
    expect(MAX_SELLERS).toBe(100)
  })

  it('answers an empty list rather than an error when there are no sellers', async () => {
    prismaSpies.seller.findMany.mockResolvedValue([])

    const res = mockRes()
    await handler(mockReq('/api/sellers'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ sellers: [], total: 0 })
  })

  it('returns 405 with Allow: GET for a POST and never queries', async () => {
    const res = mockRes()
    await handler(mockReq('/api/sellers', 'POST'), res)

    expect(res.statusCode).toBe(405)
    expect(res.headers.allow).toBe('GET')
    expect(res.body).toHaveProperty('error')
    expect(prismaSpies.seller.findMany).not.toHaveBeenCalled()
  })

  it('answers 500 JSON, logs the cause and does not leak it, when the query rejects', async () => {
    prismaSpies.seller.findMany.mockRejectedValue(new Error('P1001 secret host'))

    const res = mockRes()
    await handler(mockReq('/api/sellers'), res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    expect(errorSpy).toHaveBeenCalled()
    expect(JSON.stringify(res.body)).not.toContain('P1001')
  })
})
