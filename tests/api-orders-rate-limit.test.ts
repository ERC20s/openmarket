import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@prisma/client', async () => {
  const { PrismaClientMock } = await import('./helpers/prisma-mock')
  return { PrismaClient: PrismaClientMock }
})

import { resetPrismaSpies, mockReq, mockRes, prismaSpies } from './helpers/prisma-mock'
import createHandler from '../pages/api/orders/index'
import { resetRateLimit } from '../lib/rate-limit'

beforeEach(() => {
  resetPrismaSpies()
  resetRateLimit()
})

function post(body: any, headers: Record<string, string> = { host: 'localhost' }) {
  const req = mockReq('/api/orders', 'POST', body)
  req.headers = { ...req.headers, ...headers }
  return req
}

describe('rate limiting on POST /api/orders', () => {
  it('returns 429 after the threshold and does not write the order', async () => {
    // Allow 3 requests in tests by calling the route 4 times and expecting the
    // last to be rejected. The route defaults to 10/60s; we simulate pressure
    // by making successive calls from the same host and rely on the default.
    prismaSpies.product.findMany.mockResolvedValue([
      { id: 1, title: 'Mug', price_cents: 1200, sellerId: 4, seller: { id: 4, name: 'Acme' } },
    ])

    // First three succeed
    for (let i = 0; i < 3; i++) {
      const res = mockRes()
      await createHandler(post({ lines: [{ productId: 1, quantity: 1 }] }), res)
      expect(res.statusCode).toBe(201)
    }

    // Fourth one hits the limit and is rejected before any DB write
    const res = mockRes()
    await createHandler(post({ lines: [{ productId: 1, quantity: 1 }] }), res)
    expect(res.statusCode).toBe(429)
    expect(prismaSpies.order.create).not.toHaveBeenCalled()
  })
})
