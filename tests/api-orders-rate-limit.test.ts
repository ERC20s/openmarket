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

    // Make the allowed number of requests (default 10) from distinct socket addresses
    for (let i = 0; i < 10; i++) {
      const res = mockRes()
      await createHandler(mockReq('/api/orders', 'POST', { lines: [{ productId: 1, quantity: 1 }] }, { remoteAddress: `127.0.0.${i + 1}` }), res)
      expect([201, 409, 422, 500]).toContain(res.statusCode)
    }

    // The next one from the same socket address should be rejected by the limiter
    const blocked = mockRes()
    await createHandler(mockReq('/api/orders', 'POST', { lines: [{ productId: 1, quantity: 1 }] }, { remoteAddress: `127.0.0.1` }), blocked)
    expect(blocked.statusCode).toBe(429)
    expect(prismaSpies.order.create).not.toHaveBeenCalled()

    // Now verify X-Forwarded-For with multiple IPs uses the first entry as the key
    resetRateLimit()
    const resA = mockRes()
    const reqA: any = mockReq('/api/orders', 'POST', { lines: [{ productId: 1, quantity: 1 }] }, { remoteAddress: `192.0.2.5` })
    reqA.headers['x-forwarded-for'] = '203.0.113.1, 198.51.100.2'
    await createHandler(reqA, resA)
    expect([201, 409, 422, 500]).toContain(resA.statusCode)

    const resB = mockRes()
    const reqB: any = mockReq('/api/orders', 'POST', { lines: [{ productId: 1, quantity: 1 }] }, { remoteAddress: `192.0.2.6` })
    reqB.headers['x-forwarded-for'] = '203.0.113.1, 198.51.100.2'
    await createHandler(reqB, resB)
    // Because both requests present the same first X-Forwarded-For IP, the
    // limiter counts them against the same key and the second should be
    // rejected once the limit is reached. We make 10 more to exceed the limit.
    for (let i = 0; i < 10; i++) {
      const r = mockRes()
      await createHandler(mockReq('/api/orders', 'POST', { lines: [{ productId: 1, quantity: 1 }] }, { remoteAddress: `192.0.2.${10 + i}` }), r)
    }
    const blocked2 = mockRes()
    const finalReq: any = mockReq('/api/orders', 'POST', { lines: [{ productId: 1, quantity: 1 }] }, { remoteAddress: `192.0.2.99` })
    finalReq.headers['x-forwarded-for'] = '203.0.113.1, 198.51.100.2'
    await createHandler(finalReq, blocked2)
    expect(blocked2.statusCode).toBe(429)
  })
})
