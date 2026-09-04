import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Registered before the handlers are imported: they build their Prisma client
// at module scope. vi.mock is hoisted above these imports.
vi.mock('@prisma/client', async () => {
  const { PrismaClientMock } = await import('./helpers/prisma-mock')
  return { PrismaClient: PrismaClientMock }
})

import {
  prismaSpies,
  resetPrismaSpies,
  mockReq,
  mockRes,
  fakeProduct,
  fakeOrder,
} from './helpers/prisma-mock'
import createHandler from '../pages/api/orders/index'
import readHandler from '../pages/api/orders/[id]'

let errorSpy: any

beforeEach(() => {
  resetPrismaSpies()
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
})

function post(body: any) {
  return mockReq('/api/orders', 'POST', body)
}

// A valid reference: om_ plus 24 hex characters, built rather than typed so the
// length can never drift away from what lib/orders.ts accepts.
const REF = 'om_' + 'a1b2'.repeat(6)

describe('POST /api/orders', () => {
  it('writes the order and its item snapshots at the database price', async () => {
    prismaSpies.product.findMany.mockResolvedValue([
      fakeProduct({ id: 1, title: 'Mug', price_cents: 1200, sellerId: 4, seller: { id: 4, name: 'Acme' } }),
      fakeProduct({ id: 3, title: 'Pen', price_cents: 250, sellerId: 7, seller: { id: 7, name: 'Bodega' } }),
    ])

    const res = mockRes()
    await createHandler(
      post({
        lines: [
          { productId: 1, quantity: 2, price_cents: 1200 },
          { productId: 3, quantity: 3, price_cents: 250 },
        ],
      }),
      res
    )

    expect(res.statusCode).toBe(201)
    expect(res.body.reference).toMatch(/^om_[0-9a-f]{24}$/)
    expect(res.body.status).toBe('pending')
    expect(res.body.total).toBe(2 * 1200 + 3 * 250)
    expect(res.body.count).toBe(5)

    const data = prismaSpies.order.create.mock.calls[0][0].data
    expect(data.total_cents).toBe(2 * 1200 + 3 * 250)
    expect(data.status).toBe('pending')
    expect(data.items.create).toHaveLength(2)
    expect(data.items.create[0]).toMatchObject({
      productId: 1,
      title: 'Mug',
      price_cents: 1200,
      quantity: 2,
      line_total: 2400,
      sellerId: 4,
      sellerName: 'Acme',
    })
  })

  it('refuses with 409, writing nothing, when the claimed price is not the stored one', async () => {
    prismaSpies.product.findMany.mockResolvedValue([
      fakeProduct({ id: 1, title: 'Mug', price_cents: 1200, sellerId: 4, seller: { id: 4, name: 'Acme' } }),
    ])

    const res = mockRes()
    await createHandler(post({ lines: [{ productId: 1, quantity: 1, price_cents: 1 }] }), res)

    // The claim disagrees with the stored price, so nothing is written at all.
    expect(res.statusCode).toBe(409)
    expect(prismaSpies.order.create).not.toHaveBeenCalled()
    expect(res.body.problems[0]).toMatchObject({ code: 'price_changed', productId: 1, was: 1, now: 1200 })
    expect(res.body.total).toBe(1200)
  })

  it('answers 409 and writes nothing when a product was delisted', async () => {
    prismaSpies.product.findMany.mockResolvedValue([])

    const res = mockRes()
    await createHandler(post({ lines: [{ productId: 42, quantity: 1 }] }), res)

    expect(res.statusCode).toBe(409)
    expect(res.body.problems[0]).toMatchObject({ code: 'product_missing', productId: 42 })
    expect(prismaSpies.order.create).not.toHaveBeenCalled()
  })

  it('queries only the requested ids and never selects a seller email', async () => {
    prismaSpies.product.findMany.mockResolvedValue([
      fakeProduct({ id: 2, price_cents: 500, sellerId: 1, seller: { id: 1, name: 'A seller' } }),
    ])

    const res = mockRes()
    await createHandler(post({ lines: [{ productId: 2 }] }), res)

    expect(prismaSpies.product.findMany).toHaveBeenCalledWith({
      where: { id: { in: [2] } },
      include: { seller: { select: { id: true, name: true } } },
    })
    expect(JSON.stringify(prismaSpies.product.findMany.mock.calls[0][0])).not.toContain('email')
    expect(res.statusCode).toBe(201)
  })

  it('accepts a raw JSON string body, as a hand-rolled fetch sends it', async () => {
    prismaSpies.product.findMany.mockResolvedValue([
      fakeProduct({ id: 1, price_cents: 1234, sellerId: 1, seller: { id: 1, name: 'A seller' } }),
    ])

    const res = mockRes()
    await createHandler(post('{"lines":[{"productId":1,"quantity":1}]}'), res)

    expect(res.statusCode).toBe(201)
    expect(res.body.total).toBe(1234)
  })

  it('answers 422 for a body that is not a cart', async () => {
    for (const body of [undefined, null, 'not json', {}, { lines: 'x' }, { lines: [] }, { lines: [{ productId: 0 }] }]) {
      const res = mockRes()
      await createHandler(post(body), res)
      expect(res.statusCode).toBe(422)
      expect(typeof res.body.error).toBe('string')
    }
    expect(prismaSpies.order.create).not.toHaveBeenCalled()
  })

  it('answers 405 with Allow: POST on a GET, and JSON 500 when the write rejects', async () => {
    const notAllowed = mockRes()
    await createHandler(mockReq('/api/orders', 'GET'), notAllowed)
    expect(notAllowed.statusCode).toBe(405)
    expect(notAllowed.headers.allow).toBe('POST')

    prismaSpies.product.findMany.mockResolvedValue([
      fakeProduct({ id: 1, price_cents: 100, sellerId: 1, seller: { id: 1, name: 'A seller' } }),
    ])
    prismaSpies.order.create.mockRejectedValue(new Error('disk on fire'))

    const failed = mockRes()
    await createHandler(post({ lines: [{ productId: 1 }] }), failed)
    expect(failed.statusCode).toBe(500)
    expect(failed.body).toEqual({ error: 'Internal server error' })
  })
})

describe('GET /api/orders/[id]', () => {
  it('looks the order up by reference and returns its lines grouped by seller', async () => {
    prismaSpies.order.findUnique.mockResolvedValue(fakeOrder({ reference: REF }))

    const res = mockRes()
    await readHandler(mockReq(`/api/orders/${REF}`), res)

    expect(prismaSpies.order.findUnique).toHaveBeenCalledWith({
      where: { reference: REF },
      include: { items: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.body.reference).toBe(REF)
    expect(res.body.status).toBe('pending')
    expect(res.body.total).toBe(2400)
    expect(res.body.count).toBe(2)
    expect(res.body.sellers).toHaveLength(1)
    expect(res.body.sellers[0]).toMatchObject({ sellerId: 1, sellerName: 'A seller', subtotal: 2400 })
    expect(JSON.stringify(res.body)).not.toContain('email')
  })

  it('answers 422 for anything that is not a reference — a row id cannot be walked', async () => {
    for (const path of ['/api/orders/1', '/api/orders/om_123', '/api/orders/']) {
      const res = mockRes()
      await readHandler(mockReq(path), res)
      expect(res.statusCode).toBe(422)
      expect(res.body).toEqual({ error: 'Invalid reference' })
    }
    expect(prismaSpies.order.findUnique).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown reference', async () => {
    prismaSpies.order.findUnique.mockResolvedValue(null)

    const res = mockRes()
    await readHandler(mockReq(`/api/orders/om_${'f'.repeat(24)}`), res)

    expect(res.statusCode).toBe(404)
    expect(res.body).toEqual({ error: 'Order not found' })
  })

  it('answers 405 with Allow: GET on a POST, and JSON 500 when the query rejects', async () => {
    const notAllowed = mockRes()
    await readHandler(mockReq(`/api/orders/${REF}`, 'POST'), notAllowed)
    expect(notAllowed.statusCode).toBe(405)
    expect(notAllowed.headers.allow).toBe('GET')

    prismaSpies.order.findUnique.mockRejectedValue(new Error('nope'))
    const failed = mockRes()
    await readHandler(mockReq(`/api/orders/${REF}`), failed)
    expect(failed.statusCode).toBe(500)
    expect(failed.body).toEqual({ error: 'Internal server error' })
  })
})
