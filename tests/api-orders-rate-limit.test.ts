import { describe, it, expect, beforeEach, vi } from 'vitest'

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
  prismaSpies.product.findMany.mockResolvedValue([
    { id: 1, title: 'Mug', price_cents: 1200, sellerId: 4, seller: { id: 4, name: 'Acme' } },
  ])
})

const body = { lines: [{ productId: 1, quantity: 1 }] }

function fromSocket(remoteAddress: string, forwardedFor?: string): any {
  const req: any = mockReq('/api/orders', 'POST', body, { remoteAddress })
  if (forwardedFor) req.headers['x-forwarded-for'] = forwardedFor
  return req
}

describe('rate limiting POST /api/orders', () => {
  it('allows the default 10 requests from one client, then answers 429 and writes nothing', async () => {
    for (let i = 0; i < 10; i++) {
      const res = mockRes()
      await createHandler(fromSocket('127.0.0.1'), res)
      expect(res.statusCode).toBe(201)
    }
    expect(prismaSpies.order.create).toHaveBeenCalledTimes(10)

    const blocked = mockRes()
    await createHandler(fromSocket('127.0.0.1'), blocked)
    expect(blocked.statusCode).toBe(429)
    expect(blocked.body).toEqual({ error: 'Too many requests' })
    expect(prismaSpies.order.create).toHaveBeenCalledTimes(10)
    expect(prismaSpies.product.findMany).toHaveBeenCalledTimes(10)

    // Another client has its own window.
    const other = mockRes()
    await createHandler(fromSocket('127.0.0.2'), other)
    expect(other.statusCode).toBe(201)
  })

  it('keys on the first X-Forwarded-For entry, not the socket address', async () => {
    for (let i = 0; i < 10; i++) {
      const res = mockRes()
      await createHandler(fromSocket(`192.0.2.${i + 1}`, '203.0.113.1, 198.51.100.2'), res)
      expect(res.statusCode).toBe(201)
    }

    const blocked = mockRes()
    await createHandler(fromSocket('192.0.2.99', '203.0.113.1, 198.51.100.3'), blocked)
    expect(blocked.statusCode).toBe(429)

    // Same proxy hop, different originating client: still allowed.
    const other = mockRes()
    await createHandler(fromSocket('192.0.2.99', '203.0.113.2, 198.51.100.2'), other)
    expect(other.statusCode).toBe(201)
  })
})
