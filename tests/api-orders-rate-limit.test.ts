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

  it('ignores X-Forwarded-For without TRUSTED_PROXY: rotating a spoofed header does not reset the limit', async () => {
    for (let i = 0; i < 10; i++) {
      const res = mockRes()
      await createHandler(fromSocket('198.51.100.7', `203.0.113.${i + 1}`), res)
      expect(res.statusCode).toBe(201)
    }

    const blocked = mockRes()
    await createHandler(fromSocket('198.51.100.7', '203.0.113.200'), blocked)
    expect(blocked.statusCode).toBe(429)
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
    expect(prismaSpies.order.create).toHaveBeenCalledTimes(10)
  })

  describe('behind TRUSTED_PROXY', () => {
    const saved = process.env.TRUSTED_PROXY
    beforeEach(() => {
      process.env.TRUSTED_PROXY = '10.0.0.5'
    })
    afterEach(() => {
      if (saved === undefined) delete process.env.TRUSTED_PROXY
      else process.env.TRUSTED_PROXY = saved
    })

    it('keys on the hop the proxy appended, so a spoofed first entry changes nothing', async () => {
      // The client writes whatever it likes first; the proxy appends the
      // address it actually saw (203.0.113.9) as the last entry.
      for (let i = 0; i < 10; i++) {
        const res = mockRes()
        await createHandler(fromSocket('10.0.0.5', `192.0.2.${i + 1}, 203.0.113.9`), res)
        expect(res.statusCode).toBe(201)
      }

      const blocked = mockRes()
      await createHandler(fromSocket('10.0.0.5', '192.0.2.250, 203.0.113.9'), blocked)
      expect(blocked.statusCode).toBe(429)

      // A different real client behind the same proxy has its own window.
      const other = mockRes()
      await createHandler(fromSocket('10.0.0.5', '192.0.2.1, 203.0.113.10'), other)
      expect(other.statusCode).toBe(201)
    })

    it('ignores X-Forwarded-For from a peer that is not the trusted proxy', async () => {
      for (let i = 0; i < 10; i++) {
        const res = mockRes()
        await createHandler(fromSocket('198.51.100.8', `203.0.113.${i + 1}`), res)
        expect(res.statusCode).toBe(201)
      }

      const blocked = mockRes()
      await createHandler(fromSocket('198.51.100.8', '203.0.113.99'), blocked)
      expect(blocked.statusCode).toBe(429)
    })
  })
})
