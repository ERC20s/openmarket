import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Registered before the handlers are imported: they build their Prisma client
// at module scope. vi.mock is hoisted above these imports.
vi.mock('@prisma/client', async () => {
  const { PrismaClientMock } = await import('./helpers/prisma-mock')
  return { PrismaClient: PrismaClientMock }
})

import { prismaSpies, resetPrismaSpies, mockReq, mockRes } from './helpers/prisma-mock'
import productsHandler from '../pages/api/products'
import productHandler from '../pages/api/products/[id]'
import sellerHandler from '../pages/api/sellers/[id]'

// The handlers log the real error before answering 500; keep the test output
// readable and assert that the diagnostic is still written.
let errorSpy: any

beforeEach(() => {
  resetPrismaSpies()
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
})

describe('method guard on /api/products', () => {
  it('returns 405 with Allow: GET for a POST and never queries', async () => {
    const res = mockRes()
    await productsHandler(mockReq('/api/products', 'POST'), res)

    expect(res.statusCode).toBe(405)
    expect(res.headers.allow).toBe('GET')
    expect(res.body).toHaveProperty('error')
    expect(prismaSpies.product.count).not.toHaveBeenCalled()
    expect(prismaSpies.product.findMany).not.toHaveBeenCalled()
  })

  it('still serves a plain GET', async () => {
    const res = mockRes()
    await productsHandler(mockReq('/api/products'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toHaveProperty('items')
  })
})

describe('JSON 500 when the database throws', () => {
  it('/api/products answers 500 JSON instead of an HTML error page', async () => {
    prismaSpies.product.findMany.mockRejectedValue(new Error('connection lost'))

    const res = mockRes()
    await productsHandler(mockReq('/api/products'), res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    expect(errorSpy).toHaveBeenCalled()
  })

  it('/api/products/[id] answers 500 JSON', async () => {
    prismaSpies.product.findUnique.mockRejectedValue(new Error('connection lost'))

    const res = mockRes()
    await productHandler(mockReq('/api/products/7'), res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    expect(errorSpy).toHaveBeenCalled()
  })

  it('/api/sellers/[id] answers 500 JSON', async () => {
    prismaSpies.seller.findUnique.mockRejectedValue(new Error('connection lost'))

    const res = mockRes()
    await sellerHandler(mockReq('/api/sellers/3'), res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    expect(errorSpy).toHaveBeenCalled()
  })

  it('does not leak the underlying message to the client', async () => {
    prismaSpies.product.count.mockRejectedValue(new Error('P1001 secret host'))

    const res = mockRes()
    await productsHandler(mockReq('/api/products'), res)

    expect(res.statusCode).toBe(500)
    expect(JSON.stringify(res.body)).not.toContain('P1001')
  })
})
