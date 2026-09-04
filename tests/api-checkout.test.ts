import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Registered before the handler is imported: it builds its Prisma client at
// module scope. vi.mock is hoisted above these imports.
vi.mock('@prisma/client', async () => {
  const { PrismaClientMock } = await import('./helpers/prisma-mock')
  return { PrismaClient: PrismaClientMock }
})

import { prismaSpies, resetPrismaSpies, mockReq, mockRes, fakeProduct } from './helpers/prisma-mock'
import handler from '../pages/api/checkout'
import { MAX_LINES } from '../lib/cart'

let errorSpy: any

beforeEach(() => {
  resetPrismaSpies()
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
})

function post(body: any) {
  return mockReq('/api/checkout', 'POST', body)
}

describe('POST /api/checkout', () => {
  it('prices every line from the database, groups by seller and totals in cents', async () => {
    prismaSpies.product.findMany.mockResolvedValue([
      fakeProduct({ id: 1, title: 'Mug', price_cents: 1200, sellerId: 4, seller: { id: 4, name: 'Acme' } }),
      fakeProduct({ id: 2, title: 'Cap', price_cents: 500, sellerId: 4, seller: { id: 4, name: 'Acme' } }),
      fakeProduct({ id: 3, title: 'Pen', price_cents: 250, sellerId: 7, seller: { id: 7, name: 'Bodega' } }),
    ])

    const res = mockRes()
    await handler(
      post({
        lines: [
          { productId: 1, quantity: 2, price_cents: 1200 },
          { productId: 2, quantity: 1, price_cents: 500 },
          { productId: 3, quantity: 3, price_cents: 250 },
        ],
      }),
      res
    )

    expect(res.statusCode).toBe(200)
    expect(res.body.total).toBe(2 * 1200 + 500 + 3 * 250)
    expect(res.body.count).toBe(6)
    expect(res.body.problems).toEqual([])
    expect(res.body.sellers.map((group: any) => [group.sellerId, group.subtotal])).toEqual([
      [4, 2900],
      [7, 750],
    ])
    expect(res.body.lines[0]).toMatchObject({ productId: 1, price_cents: 1200, line_total: 2400 })
  })

  it('queries only the requested ids and narrows the seller to id + name', async () => {
    const res = mockRes()
    await handler(post({ lines: [{ productId: 3 }, { productId: 9 }] }), res)

    expect(prismaSpies.product.findMany).toHaveBeenCalledWith({
      where: { id: { in: [3, 9] } },
      include: { seller: { select: { id: true, name: true } } },
    })

    const args = prismaSpies.product.findMany.mock.calls[0][0]
    expect(JSON.stringify(args)).not.toContain('email')
  })

  it('charges the stored price and reports the one that changed', async () => {
    prismaSpies.product.findMany.mockResolvedValue([
      fakeProduct({ id: 1, title: 'Mug', price_cents: 1500, sellerId: 4, seller: { id: 4, name: 'Acme' } }),
    ])

    const res = mockRes()
    await handler(post({ lines: [{ productId: 1, quantity: 2, price_cents: 1200 }] }), res)

    expect(res.statusCode).toBe(200)
    // The claimed 1200 is never charged: 2 x the stored 1500.
    expect(res.body.total).toBe(3000)
    expect(res.body.problems).toHaveLength(1)
    expect(res.body.problems[0]).toMatchObject({ code: 'price_changed', productId: 1, was: 1200, now: 1500 })
  })

  it('reports a product that no longer exists and leaves it out of the total', async () => {
    prismaSpies.product.findMany.mockResolvedValue([
      fakeProduct({ id: 1, title: 'Mug', price_cents: 1200, sellerId: 4, seller: { id: 4, name: 'Acme' } }),
    ])

    const res = mockRes()
    await handler(post({ lines: [{ productId: 1, quantity: 1 }, { productId: 99, quantity: 1 }] }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.total).toBe(1200)
    expect(res.body.lines).toHaveLength(1)
    expect(res.body.problems).toHaveLength(1)
    expect(res.body.problems[0]).toMatchObject({ code: 'product_missing', productId: 99 })
  })

  it('clamps a junk quantity to 1..99 and merges a repeated product', async () => {
    prismaSpies.product.findMany.mockResolvedValue([
      fakeProduct({ id: 1, price_cents: 100, sellerId: 4, seller: { id: 4, name: 'Acme' } }),
    ])

    const res = mockRes()
    await handler(
      post({ lines: [{ productId: 1, quantity: 'many' }, { productId: 1, quantity: 500 }] }),
      res
    )

    expect(res.statusCode).toBe(200)
    expect(prismaSpies.product.findMany.mock.calls[0][0].where).toEqual({ id: { in: [1] } })
    expect(res.body.lines).toHaveLength(1)
    expect(res.body.lines[0].quantity).toBe(99)
    expect(res.body.total).toBe(9900)
  })

  it('accepts a raw JSON string body, as a hand-rolled fetch can send', async () => {
    prismaSpies.product.findMany.mockResolvedValue([
      fakeProduct({ id: 1, price_cents: 100, sellerId: 4, seller: { id: 4, name: 'Acme' } }),
    ])

    const res = mockRes()
    await handler(post(JSON.stringify({ lines: [{ productId: 1, quantity: 1 }] })), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.total).toBe(100)
  })

  it('answers 422 for junk and never queries', async () => {
    const bodies: any[] = [
      undefined,
      'not json',
      {},
      { lines: 'nope' },
      { lines: [] },
      { lines: [null] },
      { lines: [{ productId: 0 }] },
      { lines: [{ productId: 'abc' }] },
      { lines: [{ productId: 1.5 }] },
      { lines: Array.from({ length: MAX_LINES + 1 }, (_value, index) => ({ productId: index + 1 })) },
    ]

    for (const body of bodies) {
      const res = mockRes()
      await handler(post(body), res)
      expect(res.statusCode, JSON.stringify(body)).toBe(422)
      expect(res.body).toHaveProperty('error')
    }

    expect(prismaSpies.product.findMany).not.toHaveBeenCalled()
  })

  it('returns 405 with Allow: POST for a GET and never queries', async () => {
    const res = mockRes()
    await handler(mockReq('/api/checkout'), res)

    expect(res.statusCode).toBe(405)
    expect(res.headers.allow).toBe('POST')
    expect(res.body).toHaveProperty('error')
    expect(prismaSpies.product.findMany).not.toHaveBeenCalled()
  })

  it('answers 500 JSON, logs the cause and does not leak it, when the query rejects', async () => {
    prismaSpies.product.findMany.mockRejectedValue(new Error('P1001 secret host'))

    const res = mockRes()
    await handler(post({ lines: [{ productId: 1 }] }), res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    expect(errorSpy).toHaveBeenCalled()
    expect(JSON.stringify(res.body)).not.toContain('P1001')
  })
})
