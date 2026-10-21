import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@prisma/client', async () => {
  const { PrismaClientMock } = await import('./helpers/prisma-mock')
  return { PrismaClient: PrismaClientMock }
})

import { prismaSpies, resetPrismaSpies, mockReq, mockRes, fakeProduct } from './helpers/prisma-mock'
import handler from '../pages/api/products/[id]'

beforeEach(() => {
  resetPrismaSpies()
})

describe('GET /api/products/[id]', () => {
  it('returns the product with its seller narrowed to id and name', async () => {
    const product = fakeProduct({ id: 7, seller: { id: 3, name: 'Acme' } })
    prismaSpies.product.findUnique.mockResolvedValue(product)

    const res = mockRes()
    await handler(mockReq('/api/products/7'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual(product)
    expect(prismaSpies.product.findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      include: { seller: { select: { id: true, name: true } } },
    })
  })

  it('returns 404 when the row is missing', async () => {
    prismaSpies.product.findUnique.mockResolvedValue(null)

    const res = mockRes()
    await handler(mockReq('/api/products/99999999'), res)

    expect(res.statusCode).toBe(404)
    expect(res.body).toHaveProperty('error')
  })

  it('returns 400 for a non-numeric or zero id', async () => {
    const notANumber = mockRes()
    await handler(mockReq('/api/products/abc'), notANumber)
    expect(notANumber.statusCode).toBe(400)

    const zero = mockRes()
    await handler(mockReq('/api/products/0'), zero)
    expect(zero.statusCode).toBe(400)

    expect(prismaSpies.product.findUnique).not.toHaveBeenCalled()
  })

  it('returns 405 with Allow: GET, PATCH, DELETE for a POST', async () => {
    const res = mockRes()
    await handler(mockReq('/api/products/7', 'POST'), res)

    expect(res.statusCode).toBe(405)
    expect(res.headers.allow).toBe('GET, PATCH, DELETE')
    expect(prismaSpies.product.findUnique).not.toHaveBeenCalled()
  })
})
