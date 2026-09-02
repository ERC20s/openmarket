import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@prisma/client', async () => {
  const { PrismaClientMock } = await import('./helpers/prisma-mock')
  return { PrismaClient: PrismaClientMock }
})

import { prismaSpies, resetPrismaSpies, mockReq, mockRes, fakeProduct } from './helpers/prisma-mock'
import handler from '../pages/api/sellers/[id]'

beforeEach(() => {
  resetPrismaSpies()
})

describe('GET /api/sellers/[id]', () => {
  it('returns the seller with its products and paging metadata', async () => {
    const rows = [fakeProduct({ id: 11, sellerId: 4 })]
    prismaSpies.seller.findUnique.mockResolvedValue({ id: 4, name: 'Acme' })
    prismaSpies.product.count.mockResolvedValue(3)
    prismaSpies.product.findMany.mockResolvedValue(rows)

    const res = mockRes()
    await handler(mockReq('/api/sellers/4'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.seller).toEqual({ id: 4, name: 'Acme' })
    expect(res.body.products).toEqual(rows)
    expect(res.body.total).toBe(3)
    expect(prismaSpies.product.count).toHaveBeenCalledWith({ where: { sellerId: 4 } })
  })

  it('never ships the seller email: the query selects id and name only', async () => {
    prismaSpies.seller.findUnique.mockResolvedValue({ id: 4, name: 'Acme' })

    const res = mockRes()
    await handler(mockReq('/api/sellers/4'), res)

    expect(prismaSpies.seller.findUnique).toHaveBeenCalledWith({
      where: { id: 4 },
      select: { id: true, name: true },
    })
    expect(Object.keys(res.body.seller).sort()).toEqual(['id', 'name'])
    expect(res.body.seller).not.toHaveProperty('email')
  })

  it('paginates the seller products with an offset and a newest-first order', async () => {
    prismaSpies.seller.findUnique.mockResolvedValue({ id: 4, name: 'Acme' })

    const res = mockRes()
    await handler(mockReq('/api/sellers/4?page=2&size=5'), res)

    expect(res.statusCode).toBe(200)
    expect(prismaSpies.product.findMany).toHaveBeenCalledWith({
      where: { sellerId: 4 },
      skip: 5,
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { seller: { select: { id: true, name: true } } },
    })
  })

  it('returns 404 for an unknown seller and does not query products', async () => {
    prismaSpies.seller.findUnique.mockResolvedValue(null)

    const res = mockRes()
    await handler(mockReq('/api/sellers/99999999'), res)

    expect(res.statusCode).toBe(404)
    expect(res.body).toHaveProperty('error')
    expect(prismaSpies.product.count).not.toHaveBeenCalled()
    expect(prismaSpies.product.findMany).not.toHaveBeenCalled()
  })

  it('returns 422 for a bad id or a bad page, and 405 with Allow: GET for a POST', async () => {
    const badId = mockRes()
    await handler(mockReq('/api/sellers/abc'), badId)
    expect(badId.statusCode).toBe(422)

    const badPage = mockRes()
    await handler(mockReq('/api/sellers/4?page=0'), badPage)
    expect(badPage.statusCode).toBe(422)

    const posted = mockRes()
    await handler(mockReq('/api/sellers/4', 'POST'), posted)
    expect(posted.statusCode).toBe(405)
    expect(posted.headers.allow).toBe('GET')

    expect(prismaSpies.seller.findUnique).not.toHaveBeenCalled()
  })
})
