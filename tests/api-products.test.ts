import { describe, it, expect, beforeEach, vi } from 'vitest'

// Must be registered before the handler is imported: the handler builds its
// Prisma client at module scope. vi.mock is hoisted above these imports.
vi.mock('@prisma/client', async () => {
  const { PrismaClientMock } = await import('./helpers/prisma-mock')
  return { PrismaClient: PrismaClientMock }
})

import { prismaSpies, resetPrismaSpies, mockReq, mockRes, fakeProduct } from './helpers/prisma-mock'
import handler from '../pages/api/products'

beforeEach(() => {
  resetPrismaSpies()
})

describe('GET /api/products pagination', () => {
  it('asks for the requested page and echoes page/size/total', async () => {
    const rows = [fakeProduct({ id: 21 }), fakeProduct({ id: 22 })]
    prismaSpies.product.count.mockResolvedValue(42)
    prismaSpies.product.findMany.mockResolvedValue(rows)

    const res = mockRes()
    await handler(mockReq('/api/products?page=3&size=10'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.items).toEqual(rows)
    expect(res.body.total).toBe(42)
    expect(res.body.page).toBe(3)
    expect(res.body.size).toBe(10)

    expect(prismaSpies.product.findMany).toHaveBeenCalledTimes(1)
    expect(prismaSpies.product.findMany).toHaveBeenCalledWith({
      skip: 20,
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: { seller: { select: { id: true, name: true } } },
    })
  })

  it('defaults to page 1, size 20 when no query is given', async () => {
    const res = mockRes()
    await handler(mockReq('/api/products'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.page).toBe(1)
    expect(res.body.size).toBe(20)
    expect(prismaSpies.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 })
    )
  })

  it('returns 422 for page=0 without touching the database', async () => {
    const res = mockRes()
    await handler(mockReq('/api/products?page=0&size=20'), res)

    expect(res.statusCode).toBe(422)
    expect(res.body).toHaveProperty('error')
    expect(prismaSpies.product.count).not.toHaveBeenCalled()
    expect(prismaSpies.product.findMany).not.toHaveBeenCalled()
  })

  it('returns 422 for a size above the 100 cap and for a non-numeric size', async () => {
    const tooBig = mockRes()
    await handler(mockReq('/api/products?size=101'), tooBig)
    expect(tooBig.statusCode).toBe(422)

    const nonsense = mockRes()
    await handler(mockReq('/api/products?size=abc'), nonsense)
    expect(nonsense.statusCode).toBe(422)

    expect(prismaSpies.product.findMany).not.toHaveBeenCalled()
  })
})
