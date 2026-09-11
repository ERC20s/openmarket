import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@prisma/client', async () => {
  const { PrismaClientMock } = await import('./helpers/prisma-mock')
  return { PrismaClient: PrismaClientMock }
})

import { prismaSpies, resetPrismaSpies, mockReq, mockRes } from './helpers/prisma-mock'
import createHandler from '../pages/api/orders/index'
import { resetRateLimit } from '../lib/rate-limit'

beforeEach(() => {
  resetPrismaSpies()
  resetRateLimit()
})

describe('rate limiting POST /api/orders', () => {
  it('allows up to the default threshold and then returns 429 and writes nothing', async () => {
    prismaSpies.product.findMany.mockResolvedValue([
      { id: 1, title: 'Mug', price_cents: 1200, sellerId: 4, seller: { id: 4, name: 'Acme' } },
    ])

    // Make the allowed number of requests (default 10)
    for (let i = 0; i < 10; i++) {
      const res = mockRes()
      await createHandler(mockReq('/api/orders', 'POST', { lines: [{ productId: 1, quantity: 1 }] }), res)
      expect([201, 409, 422, 500]).toContain(res.statusCode)
    }

    // The next one should be rejected by the limiter
    const blocked = mockRes()
    await createHandler(mockReq('/api/orders', 'POST', { lines: [{ productId: 1, quantity: 1 }] }), blocked)
    expect(blocked.statusCode).toBe(429)
    expect(prismaSpies.order.create).not.toHaveBeenCalled()
  })
})
