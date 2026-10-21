import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@prisma/client', async () => {
  const { PrismaClientMock } = await import('./helpers/prisma-mock')
  return { PrismaClient: PrismaClientMock }
})

import { prismaSpies, resetPrismaSpies, mockReq, mockRes } from './helpers/prisma-mock'
import { hashToken } from '../lib/auth'
import { MAX_PAGE } from '../lib/products-query'
import { resetRateLimit } from '../lib/rate-limit'
import {
  check,
  idParam,
  pathSegment,
  productUpdateBody,
  productsQuery,
  requestUrl,
} from '../lib/validation'
import productsHandler from '../pages/api/products'
import productHandler from '../pages/api/products/[id]'
import sellerHandler from '../pages/api/sellers/[id]'
import sellerOrdersHandler from '../pages/api/sellers/[id]/orders'
import checkoutHandler from '../pages/api/checkout'
import ordersHandler from '../pages/api/orders/index'
import orderHandler from '../pages/api/orders/[id]'

const SELLER_TOKEN = 'S'.repeat(43)
const REF = 'om_' + 'e5f6'.repeat(6)

let errorSpy: any

beforeEach(() => {
  resetPrismaSpies()
  resetRateLimit()
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  prismaSpies.seller.findUnique.mockImplementation(async (args: any) =>
    args?.where?.apiTokenHash === hashToken(SELLER_TOKEN) ? { id: 4 } : null
  )
})

afterEach(() => {
  errorSpy.mockRestore()
})

function expectNoDataQuery() {
  expect(prismaSpies.product.count).not.toHaveBeenCalled()
  expect(prismaSpies.product.findMany).not.toHaveBeenCalled()
  expect(prismaSpies.product.findUnique).not.toHaveBeenCalled()
  expect(prismaSpies.product.create).not.toHaveBeenCalled()
  expect(prismaSpies.product.update).not.toHaveBeenCalled()
  expect(prismaSpies.seller.update).not.toHaveBeenCalled()
  expect(prismaSpies.order.findUnique).not.toHaveBeenCalled()
  expect(prismaSpies.order.create).not.toHaveBeenCalled()
  expect(prismaSpies.orderItem.findMany).not.toHaveBeenCalled()
}

async function expect400(handler: (req: any, res: any) => Promise<void>, req: any) {
  const res = mockRes()
  await handler(req, res)
  expect(res.statusCode, `${req.method} ${req.url} ${JSON.stringify(req.body)}`).toBe(400)
  expect(typeof res.body?.error).toBe('string')
}

describe('every route answers 400, never 500, for bad input — before any query', () => {
  it('GET /api/products: page, size, q and sellerId', async () => {
    for (const query of [
      'page=0', 'page=-1', 'page=1.5', 'page=1e3', 'page=abc', `page=${MAX_PAGE + 1}`, 'page=99999999999999999999',
      'size=0', 'size=101', 'size=ten', 'sellerId=0', 'sellerId=abc', 'sellerId=1;DROP', `q=${'a'.repeat(101)}`,
    ]) {
      await expect400(productsHandler, mockReq(`/api/products?${query}`))
    }
    expectNoDataQuery()
  })

  it('GET /api/products/[id], /api/sellers/[id] and /api/sellers/[id]/orders: ids and pages', async () => {
    for (const id of ['0', '-3', 'abc', '1.5', '7x', '99999999999', '%E0%A4%A']) {
      await expect400(productHandler, mockReq(`/api/products/${id}`))
      await expect400(sellerHandler, mockReq(`/api/sellers/${id}`))
      await expect400(sellerOrdersHandler, mockReq(`/api/sellers/${id}/orders`))
    }
    await expect400(sellerHandler, mockReq('/api/sellers/4?size=500'))
    await expect400(sellerOrdersHandler, mockReq(`/api/sellers/4/orders?page=${MAX_PAGE + 1}`))
    expect(prismaSpies.seller.findUnique).not.toHaveBeenCalled()
    expectNoDataQuery()
  })

  it('POST /api/checkout and POST /api/orders: the cart body', async () => {
    for (const body of [
      undefined, null, 'not json', 42, [], {}, { lines: {} }, { lines: [] }, { lines: [42] },
      { lines: [{ productId: -1 }] }, { lines: [{ productId: 1, quantity: 100 }] },
      { lines: [{ productId: 1, quantity: 1.5 }] }, { lines: [{ productId: 1, price_cents: 'free' }] },
      { lines: Array.from({ length: 51 }, (_value, index) => ({ productId: index + 1 })) },
    ]) {
      await expect400(checkoutHandler, mockReq('/api/checkout', 'POST', body))
      // Every one comes from a different client: this is about validation, not the rate limit.
      resetRateLimit()
      await expect400(ordersHandler, mockReq('/api/orders', 'POST', body))
    }
    expectNoDataQuery()
  })

  it('PATCH /api/products/[id] and POST /api/products: the product body', async () => {
    const auth = (req: any) => {
      req.headers.authorization = `Bearer ${SELLER_TOKEN}`
      return req
    }
    for (const body of [
      null, 'x', {}, { title: '' }, { title: 't'.repeat(201) }, { price_cents: -1 }, { price_cents: 1.5 },
      { price_cents: '100' }, { price_cents: 10_000_001 }, { description: 5 }, { sellerId: 2 }, { id: 3 },
    ]) {
      await expect400(productHandler, auth(mockReq('/api/products/9', 'PATCH', body)))
    }
    for (const body of [null, {}, { title: 'Lamp' }, { price_cents: 100 }, { title: 'Lamp', price_cents: 100, createdAt: 'x' }]) {
      await expect400(productsHandler, auth(mockReq('/api/products', 'POST', body)))
    }
    expectNoDataQuery()
  })

  it('GET and PATCH /api/orders/[id]: the reference', async () => {
    for (const ref of ['1', 'om_123', 'OM_' + 'a'.repeat(24), REF + 'x', '%E0%A4%A']) {
      await expect400(orderHandler, mockReq(`/api/orders/${ref}`))
    }
    expectNoDataQuery()
  })

  it('survives a request URL or Host header that is not a URL at all', async () => {
    const req = mockReq('/api/products?page=2')
    req.headers.host = 'bad host:/\\'
    const res = mockRes()
    await productsHandler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.page).toBe(2)
  })
})

describe('lib/validation helpers', () => {
  it('parses a good products query and applies the defaults', () => {
    expect(check(productsQuery, {})).toEqual({ data: { page: 1, size: 20, q: '' } })
    expect(check(productsQuery, { page: '3', size: '50', q: '  mug ', sellerId: '4' })).toEqual({
      data: { page: 3, size: 50, q: 'mug', sellerId: 4 },
    })
  })

  it('keeps the short reasons the pages show', () => {
    expect(check(idParam, '0')).toEqual({ error: 'Invalid id' })
    expect(check(productsQuery, { sellerId: 'x' })).toEqual({ error: 'Invalid sellerId' })
    expect(check(productUpdateBody, {})).toEqual({ error: 'Nothing to update' })
  })

  it('reads path segments without throwing on bad percent-encoding', () => {
    expect(pathSegment(requestUrl({ url: '/api/sellers/4/orders' }), 1)).toBe('4')
    expect(pathSegment(requestUrl({ url: '/api/orders/%E0%A4%A' }))).toBeUndefined()
    expect(pathSegment(requestUrl({ url: '/api/orders/' }))).toBe('')
  })
})
