import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@prisma/client', async () => {
  const { PrismaClientMock } = await import('./helpers/prisma-mock')
  return { PrismaClient: PrismaClientMock }
})

import { prismaSpies, resetPrismaSpies, mockReq, mockRes, fakeOrderItem } from './helpers/prisma-mock'
import handler from '../pages/api/sellers/[id]/orders'

beforeEach(() => {
  resetPrismaSpies()
})

describe('GET /api/sellers/[id]/orders', () => {
  it('groups this seller\'s order items back into orders, newest order first', async () => {
    prismaSpies.seller.findUnique.mockResolvedValue({ id: 4, name: 'Acme' })
    prismaSpies.orderItem.findMany
      .mockResolvedValueOnce([{ orderId: 9 }, { orderId: 7 }])
      .mockResolvedValueOnce([
        fakeOrderItem({ orderId: 9, sellerId: 4, title: 'Widget', line_total: 1000, order: { status: 'paid', createdAt: new Date('2024-02-01') } }),
        fakeOrderItem({ orderId: 7, sellerId: 4, title: 'Gadget', line_total: 500, order: { status: 'pending', createdAt: new Date('2024-01-01') } }),
      ])

    const res = mockRes()
    await handler(mockReq('/api/sellers/4/orders'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.seller).toEqual({ id: 4, name: 'Acme' })
    expect(res.body.total).toBe(2)
    expect(res.body.orders).toHaveLength(2)
    expect(res.body.orders[0]).toMatchObject({ status: 'paid', subtotal: 1000 })
    expect(res.body.orders[1]).toMatchObject({ status: 'pending', subtotal: 500 })
  })

  it('never returns the order reference or another seller\'s lines', async () => {
    prismaSpies.seller.findUnique.mockResolvedValue({ id: 4, name: 'Acme' })
    prismaSpies.orderItem.findMany
      .mockResolvedValueOnce([{ orderId: 9 }])
      .mockResolvedValueOnce([fakeOrderItem({ orderId: 9, sellerId: 4 })])

    const res = mockRes()
    await handler(mockReq('/api/sellers/4/orders'), res)

    const body = JSON.stringify(res.body)
    expect(body).not.toContain('reference')
    expect(prismaSpies.orderItem.findMany).toHaveBeenNthCalledWith(2, {
      where: { sellerId: 4, orderId: { in: [9] } },
      include: { order: { select: { status: true, createdAt: true } } },
    })
  })

  it('returns an empty list, not an error, for a seller with no orders', async () => {
    prismaSpies.seller.findUnique.mockResolvedValue({ id: 4, name: 'Acme' })
    prismaSpies.orderItem.findMany.mockResolvedValueOnce([])

    const res = mockRes()
    await handler(mockReq('/api/sellers/4/orders'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.orders).toEqual([])
    expect(res.body.total).toBe(0)
    // No orders to fetch lines for: the second query never runs.
    expect(prismaSpies.orderItem.findMany).toHaveBeenCalledTimes(1)
  })

  it('returns 404 for an unknown seller and does not query orders', async () => {
    prismaSpies.seller.findUnique.mockResolvedValue(null)

    const res = mockRes()
    await handler(mockReq('/api/sellers/99999999/orders'), res)

    expect(res.statusCode).toBe(404)
    expect(prismaSpies.orderItem.findMany).not.toHaveBeenCalled()
  })

  it('returns 422 for a bad id or a bad page, and 405 with Allow: GET for a POST', async () => {
    const badId = mockRes()
    await handler(mockReq('/api/sellers/abc/orders'), badId)
    expect(badId.statusCode).toBe(422)

    const badPage = mockRes()
    await handler(mockReq('/api/sellers/4/orders?page=0'), badPage)
    expect(badPage.statusCode).toBe(422)

    const posted = mockRes()
    await handler(mockReq('/api/sellers/4/orders', 'POST'), posted)
    expect(posted.statusCode).toBe(405)
    expect(posted.headers.allow).toBe('GET')

    expect(prismaSpies.seller.findUnique).not.toHaveBeenCalled()
  })

  it('paginates at the order level with an offset derived from page and size', async () => {
    prismaSpies.seller.findUnique.mockResolvedValue({ id: 4, name: 'Acme' })
    prismaSpies.orderItem.findMany
      .mockResolvedValueOnce([{ orderId: 5 }, { orderId: 4 }, { orderId: 3 }])
      .mockResolvedValueOnce([fakeOrderItem({ orderId: 3, sellerId: 4 })])

    const res = mockRes()
    await handler(mockReq('/api/sellers/4/orders?page=2&size=2'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.total).toBe(3)
    expect(prismaSpies.orderItem.findMany).toHaveBeenNthCalledWith(2, {
      where: { sellerId: 4, orderId: { in: [3] } },
      include: { order: { select: { status: true, createdAt: true } } },
    })
  })
})
