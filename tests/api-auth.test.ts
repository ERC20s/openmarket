import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Registered before the handlers are imported: they build their Prisma client
// at module scope. vi.mock is hoisted above these imports.
vi.mock('@prisma/client', async () => {
  const { PrismaClientMock } = await import('./helpers/prisma-mock')
  return { PrismaClient: PrismaClientMock }
})

import { prismaSpies, resetPrismaSpies, mockReq, mockRes, fakeProduct, fakeOrder } from './helpers/prisma-mock'
import { BUYER_COOKIE, hashToken } from '../lib/auth'
import { resetRateLimit } from '../lib/rate-limit'
import productsHandler from '../pages/api/products'
import productHandler from '../pages/api/products/[id]'
import sellerHandler from '../pages/api/sellers/[id]'
import ordersHandler from '../pages/api/orders/index'
import orderHandler from '../pages/api/orders/[id]'

// Two sellers, each holding the API token lib/auth.ts would have issued them.
const ALICE = { id: 4, token: 'A'.repeat(43) }
const BOB = { id: 7, token: 'B'.repeat(43) }

// Two buyers, each with the cookie POST /api/orders hands their browser.
const BUYER_ONE = 'x'.repeat(43)
const BUYER_TWO = 'y'.repeat(43)

const REF = 'om_' + 'c3d4'.repeat(6)

let errorSpy: any

beforeEach(() => {
  resetPrismaSpies()
  resetRateLimit()
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  // The token lookup: only a known token hash finds a seller.
  prismaSpies.seller.findUnique.mockImplementation(async (args: any) => {
    const hash = args?.where?.apiTokenHash
    if (hash === hashToken(ALICE.token)) return { id: ALICE.id }
    if (hash === hashToken(BOB.token)) return { id: BOB.id }
    return null
  })
})

afterEach(() => {
  errorSpy.mockRestore()
})

function asSeller(req: any, seller: { token: string } | null) {
  if (seller) req.headers.authorization = `Bearer ${seller.token}`
  return req
}

function asBuyer(req: any, token: string | null) {
  if (token) req.headers.cookie = `${BUYER_COOKIE}=${token}`
  return req
}

describe('seller products', () => {
  it('creates a product under the token holder, never a sellerId from the body', async () => {
    prismaSpies.product.create.mockImplementation(async (args: any) => fakeProduct({ id: 50, ...args.data }))

    const res = mockRes()
    await productsHandler(
      asSeller(mockReq('/api/products', 'POST', { title: 'Lamp', price_cents: 4500 }), ALICE),
      res
    )

    expect(res.statusCode).toBe(201)
    expect(prismaSpies.product.create.mock.calls[0][0].data).toEqual({
      title: 'Lamp',
      description: '',
      price_cents: 4500,
      sellerId: ALICE.id,
    })
  })

  it('refuses a create that tries to name another seller, and one with no or a bad token', async () => {
    const smuggled = mockRes()
    await productsHandler(
      asSeller(mockReq('/api/products', 'POST', { title: 'Lamp', price_cents: 1, sellerId: BOB.id }), ALICE),
      smuggled
    )
    expect(smuggled.statusCode).toBe(400)

    const anonymous = mockRes()
    await productsHandler(mockReq('/api/products', 'POST', { title: 'Lamp', price_cents: 1 }), anonymous)
    expect(anonymous.statusCode).toBe(401)

    const forged = mockRes()
    await productsHandler(
      asSeller(mockReq('/api/products', 'POST', { title: 'Lamp', price_cents: 1 }), { token: 'Z'.repeat(43) }),
      forged
    )
    expect(forged.statusCode).toBe(401)

    expect(prismaSpies.product.create).not.toHaveBeenCalled()
  })

  it('lets a seller edit their own product', async () => {
    prismaSpies.product.findUnique.mockResolvedValue({ id: 9, sellerId: ALICE.id })
    prismaSpies.product.update.mockResolvedValue(fakeProduct({ id: 9, sellerId: ALICE.id, price_cents: 999 }))

    const res = mockRes()
    await productHandler(asSeller(mockReq('/api/products/9', 'PATCH', { price_cents: 999 }), ALICE), res)

    expect(res.statusCode).toBe(200)
    expect(prismaSpies.product.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { price_cents: 999 },
      include: { seller: { select: { id: true, name: true } } },
    })
  })

  it("refuses another seller's edit and delete with 403 and writes nothing", async () => {
    prismaSpies.product.findUnique.mockResolvedValue({ id: 9, sellerId: ALICE.id })

    const edit = mockRes()
    await productHandler(asSeller(mockReq('/api/products/9', 'PATCH', { price_cents: 1 }), BOB), edit)
    expect(edit.statusCode).toBe(403)
    expect(edit.body).toEqual({ error: 'Forbidden' })

    const remove = mockRes()
    await productHandler(asSeller(mockReq('/api/products/9', 'DELETE'), BOB), remove)
    expect(remove.statusCode).toBe(403)

    expect(prismaSpies.product.update).not.toHaveBeenCalled()
    expect(prismaSpies.product.delete).not.toHaveBeenCalled()
  })

  it('refuses an anonymous edit with 401 before reading the product', async () => {
    const res = mockRes()
    await productHandler(mockReq('/api/products/9', 'PATCH', { price_cents: 1 }), res)

    expect(res.statusCode).toBe(401)
    expect(prismaSpies.product.findUnique).not.toHaveBeenCalled()
    expect(prismaSpies.product.update).not.toHaveBeenCalled()
  })

  it('lets a seller delist their own product, and answers 404 for one that does not exist', async () => {
    prismaSpies.product.findUnique.mockResolvedValueOnce({ id: 9, sellerId: ALICE.id })
    const res = mockRes()
    await productHandler(asSeller(mockReq('/api/products/9', 'DELETE'), ALICE), res)
    expect(res.statusCode).toBe(204)
    expect(prismaSpies.product.delete).toHaveBeenCalledWith({ where: { id: 9 } })

    const missing = mockRes()
    await productHandler(asSeller(mockReq('/api/products/10', 'DELETE'), ALICE), missing)
    expect(missing.statusCode).toBe(404)
    expect(prismaSpies.product.delete).toHaveBeenCalledTimes(1)
  })
})

describe('seller storefront', () => {
  it('lets a seller rename their own storefront', async () => {
    prismaSpies.seller.update.mockResolvedValue({ id: ALICE.id, name: 'Alice & Co' })

    const res = mockRes()
    await sellerHandler(asSeller(mockReq(`/api/sellers/${ALICE.id}`, 'PATCH', { name: ' Alice & Co ' }), ALICE), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ seller: { id: ALICE.id, name: 'Alice & Co' } })
    expect(prismaSpies.seller.update).toHaveBeenCalledWith({
      where: { id: ALICE.id },
      data: { name: 'Alice & Co' },
      select: { id: true, name: true },
    })
  })

  it("refuses another seller's storefront with 403 and an anonymous one with 401", async () => {
    const other = mockRes()
    await sellerHandler(asSeller(mockReq(`/api/sellers/${ALICE.id}`, 'PATCH', { name: 'Mine now' }), BOB), other)
    expect(other.statusCode).toBe(403)

    const anonymous = mockRes()
    await sellerHandler(mockReq(`/api/sellers/${ALICE.id}`, 'PATCH', { name: 'Mine now' }), anonymous)
    expect(anonymous.statusCode).toBe(401)

    expect(prismaSpies.seller.update).not.toHaveBeenCalled()
  })

  it('refuses a storefront change that tries to write the email or token columns', async () => {
    for (const body of [{ name: 'x', email: 'a@b.c' }, { apiTokenHash: 'x' }, { name: '' }, { name: 'n'.repeat(101) }]) {
      const res = mockRes()
      await sellerHandler(asSeller(mockReq(`/api/sellers/${ALICE.id}`, 'PATCH', body), ALICE), res)
      expect(res.statusCode, JSON.stringify(body)).toBe(400)
    }
    expect(prismaSpies.seller.update).not.toHaveBeenCalled()
  })
})

describe('buyer orders', () => {
  beforeEach(() => {
    prismaSpies.product.findMany.mockResolvedValue([
      fakeProduct({ id: 1, price_cents: 100, sellerId: 4, seller: { id: 4, name: 'Acme' } }),
    ])
  })

  it('gives a new buyer an HttpOnly cookie and stores only its hash on the order', async () => {
    const res = mockRes()
    await ordersHandler(mockReq('/api/orders', 'POST', { lines: [{ productId: 1 }] }), res)

    expect(res.statusCode).toBe(201)
    const cookie: string = res.headers['set-cookie']
    expect(cookie).toMatch(new RegExp(`^${BUYER_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; HttpOnly; SameSite=Lax`))

    const token = cookie.split(';')[0].split('=')[1]
    const stored = prismaSpies.order.create.mock.calls[0][0].data.buyerTokenHash
    expect(stored).toBe(hashToken(token))
    expect(stored).not.toContain(token)
    expect(JSON.stringify(res.body)).not.toContain(token)
  })

  it('reuses the cookie a returning buyer already holds', async () => {
    const res = mockRes()
    await ordersHandler(asBuyer(mockReq('/api/orders', 'POST', { lines: [{ productId: 1 }] }), BUYER_ONE), res)

    expect(res.statusCode).toBe(201)
    expect(prismaSpies.order.create.mock.calls[0][0].data.buyerTokenHash).toBe(hashToken(BUYER_ONE))
    expect(res.headers['set-cookie']).toContain(`${BUYER_COOKIE}=${BUYER_ONE};`)
  })

  it('refuses an order posted from another site, so a third-party page cannot replace the buyer cookie', async () => {
    // A cross-site <form enctype="text/plain"> can post a JSON-looking body.
    // The SameSite=Lax cookie is not sent with it, so the route used to mint a
    // new token and Set-Cookie over the buyer's own: their earlier orders could
    // no longer be cancelled from this browser.
    const crossSite = mockReq('/api/orders', 'POST', '{"lines":[{"productId":1,"x":"="}]}')
    crossSite.headers['sec-fetch-site'] = 'cross-site'
    const refused = mockRes()
    await ordersHandler(crossSite, refused)

    expect(refused.statusCode).toBe(403)
    expect(refused.body).toEqual({ error: 'Forbidden' })
    expect(refused.headers['set-cookie']).toBeUndefined()
    expect(prismaSpies.order.create).not.toHaveBeenCalled()

    // The storefront's own fetch is same-origin and still places the order.
    const sameOrigin = asBuyer(mockReq('/api/orders', 'POST', { lines: [{ productId: 1 }] }), BUYER_ONE)
    sameOrigin.headers['sec-fetch-site'] = 'same-origin'
    const placed = mockRes()
    await ordersHandler(sameOrigin, placed)

    expect(placed.statusCode).toBe(201)
    expect(prismaSpies.order.create).toHaveBeenCalledTimes(1)
    expect(placed.headers['set-cookie']).toContain(`${BUYER_COOKIE}=${BUYER_ONE};`)
  })

  it("refuses to cancel another buyer's order with 403, even with the reference", async () => {
    prismaSpies.order.findUnique.mockResolvedValue(
      fakeOrder({ reference: REF, status: 'pending', buyerTokenHash: hashToken(BUYER_ONE) })
    )

    const res = mockRes()
    await orderHandler(asBuyer(mockReq(`/api/orders/${REF}`, 'PATCH', { status: 'cancelled' }), BUYER_TWO), res)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: 'Forbidden' })
    expect(prismaSpies.order.update).not.toHaveBeenCalled()
  })

  it('refuses a cancel with no buyer cookie with 401 before reading the order', async () => {
    const res = mockRes()
    await orderHandler(mockReq(`/api/orders/${REF}`, 'PATCH', { status: 'cancelled' }), res)

    expect(res.statusCode).toBe(401)
    expect(prismaSpies.order.findUnique).not.toHaveBeenCalled()
    expect(prismaSpies.order.update).not.toHaveBeenCalled()
  })

  it('fails closed on an order placed before buyer cookies existed', async () => {
    prismaSpies.order.findUnique.mockResolvedValue(fakeOrder({ reference: REF, status: 'pending', buyerTokenHash: null }))

    const res = mockRes()
    await orderHandler(asBuyer(mockReq(`/api/orders/${REF}`, 'PATCH', { status: 'cancelled' }), BUYER_ONE), res)

    expect(res.statusCode).toBe(403)
    expect(prismaSpies.order.update).not.toHaveBeenCalled()
  })

  it('lets the buyer who placed the order cancel it, and never returns the hash', async () => {
    const order = fakeOrder({ reference: REF, status: 'pending', buyerTokenHash: hashToken(BUYER_ONE) })
    prismaSpies.order.findUnique.mockResolvedValue(order)
    prismaSpies.order.update.mockResolvedValue({ ...order, status: 'cancelled' })

    const res = mockRes()
    await orderHandler(asBuyer(mockReq(`/api/orders/${REF}`, 'PATCH', { status: 'cancelled' }), BUYER_ONE), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.status).toBe('cancelled')
    expect(JSON.stringify(res.body)).not.toContain(hashToken(BUYER_ONE))
  })
})
