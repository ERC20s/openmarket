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

describe('GET /api/products filters', () => {
  it('passes q to a contains OR on title/description and uses same where for count', async () => {
    const rows = [fakeProduct({ id: 1 })]
    prismaSpies.product.count.mockResolvedValue(1)
    prismaSpies.product.findMany.mockResolvedValue(rows)

    const res = mockRes()
    await handler(mockReq('/api/products?q=apple&page=1&size=10'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.items).toEqual(rows)
    expect(res.body.total).toBe(1)

    const where = {
      OR: [
        { title: { contains: 'apple' } },
        { description: { contains: 'apple' } },
      ],
    }

    expect(prismaSpies.product.count).toHaveBeenCalledWith({ where })
    expect(prismaSpies.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, skip: 0, take: 10 })
    )
  })

  it('passes sellerId to where and uses same where for count', async () => {
    const rows = [fakeProduct({ id: 2 })]
    prismaSpies.product.count.mockResolvedValue(1)
    prismaSpies.product.findMany.mockResolvedValue(rows)

    const res = mockRes()
    await handler(mockReq('/api/products?sellerId=5&page=1&size=10'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.items).toEqual(rows)
    expect(res.body.total).toBe(1)

    const where = { sellerId: 5 }

    expect(prismaSpies.product.count).toHaveBeenCalledWith({ where })
    expect(prismaSpies.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, skip: 0, take: 10 })
    )
  })

  it('combines q and sellerId into the same where', async () => {
    const rows = [fakeProduct({ id: 3 })]
    prismaSpies.product.count.mockResolvedValue(1)
    prismaSpies.product.findMany.mockResolvedValue(rows)

    const res = mockRes()
    await handler(mockReq('/api/products?q=banana&sellerId=2&page=1&size=10'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.items).toEqual(rows)
    expect(res.body.total).toBe(1)

    const where = {
      sellerId: 2,
      OR: [
        { title: { contains: 'banana' } },
        { description: { contains: 'banana' } },
      ],
    }

    expect(prismaSpies.product.count).toHaveBeenCalledWith({ where })
    expect(prismaSpies.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, skip: 0, take: 10 })
    )
  })

  it('rejects an overlong q without touching the database', async () => {
    const long = 'a'.repeat(101)
    const res = mockRes()
    await handler(mockReq(`/api/products?q=${long}`), res)

    expect(res.statusCode).toBe(422)
    expect(prismaSpies.product.count).not.toHaveBeenCalled()
    expect(prismaSpies.product.findMany).not.toHaveBeenCalled()
  })

  it('rejects a bad sellerId without touching the database', async () => {
    const res = mockRes()
    await handler(mockReq('/api/products?sellerId=abc'), res)

    expect(res.statusCode).toBe(422)
    expect(prismaSpies.product.count).not.toHaveBeenCalled()
    expect(prismaSpies.product.findMany).not.toHaveBeenCalled()
  })
})
