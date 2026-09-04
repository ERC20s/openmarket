import { vi } from 'vitest'

// A thin stand-in for @prisma/client. There is no query engine here: every
// method is a vi.fn() spy and each test decides what it resolves to. The
// handlers build their client at module scope (`const prisma = new
// PrismaClient()`), so a test must register the mock before it imports the
// handler:
//
//   vi.mock('@prisma/client', async () => {
//     const { PrismaClientMock } = await import('./helpers/prisma-mock')
//     return { PrismaClient: PrismaClientMock }
//   })
//
// vi.mock is hoisted above the imports, and the dynamic import above keeps the
// spies below a single shared object: the factory and the test file see the
// same module instance, so assertions on prismaSpies see the real calls.

export const prismaSpies = {
  product: {
    count: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  seller: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  order: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
}

export class PrismaClientMock {
  product = prismaSpies.product
  seller = prismaSpies.seller
  order = prismaSpies.order
  $connect = async () => {}
  $disconnect = async () => {}
  // Prisma's $transaction takes either a callback (given a client) or an array
  // of promises. Neither shape is a real transaction here - the spies have no
  // engine to roll back - but a route that wraps its writes keeps working.
  $transaction = async (arg: any) => {
    if (typeof arg === 'function') return arg(this)
    return Promise.all(Array.isArray(arg) ? arg : [])
  }
}

// Call in beforeEach: forget previous calls and hand back the neutral answers
// (nothing found, nothing counted) so a test only states what it cares about.
export function resetPrismaSpies() {
  prismaSpies.product.count.mockReset().mockResolvedValue(0)
  prismaSpies.product.findMany.mockReset().mockResolvedValue([])
  prismaSpies.product.findUnique.mockReset().mockResolvedValue(null)
  prismaSpies.seller.findMany.mockReset().mockResolvedValue([])
  prismaSpies.seller.findUnique.mockReset().mockResolvedValue(null)
  // order.create echoes back what the route asked for, so a test that does not
  // care about the written row still gets a plausible order out of the route.
  prismaSpies.order.create.mockReset().mockImplementation(async (args: any) => ({
    id: 1,
    reference: args?.data?.reference ?? 'om_' + '0'.repeat(24),
    status: args?.data?.status ?? 'pending',
    total_cents: args?.data?.total_cents ?? 0,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    items: (args?.data?.items?.create ?? []).map((item: any, index: number) => ({
      id: index + 1,
      orderId: 1,
      ...item,
    })),
  }))
  prismaSpies.order.findUnique.mockReset().mockResolvedValue(null)
  prismaSpies.order.findMany.mockReset().mockResolvedValue([])
  prismaSpies.order.update.mockReset().mockResolvedValue(null)
}

// The request/response doubles that used to be copy-pasted into every test
// file. Deliberately untyped at the edges: `next` is a peer of the handlers,
// and the tests only need the three members the handlers touch.
// `body` is what Next.js would have parsed off a POST; GET handlers ignore it,
// so it stays optional and every existing call site keeps working.
export function mockReq(url: string, method = 'GET', body?: any): any {
  return {
    url,
    method,
    headers: { host: 'localhost' },
    body,
  }
}

export function mockRes(): any {
  const res: any = { headers: {} as Record<string, string> }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (body: any) => {
    res.body = body
    return res
  }
  res.setHeader = (name: string, value: string) => {
    res.headers[String(name).toLowerCase()] = value
    return res
  }
  res.end = () => res
  return res
}

// A product row shaped the way the handlers return it (seller narrowed to
// id + name by the include). Tests override whatever they assert on.
export function fakeProduct(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    title: 'A product',
    description: 'A description',
    price_cents: 1234,
    sellerId: 1,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    seller: { id: 1, name: 'A seller' },
    ...overrides,
  }
}

// An order row shaped the way GET /api/orders/[id] reads it: the items are
// included and each one is a snapshot of what was bought.
export function fakeOrder(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    reference: 'om_' + 'a1b2'.repeat(6),
    status: 'pending',
    total_cents: 2400,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    items: [
      {
        id: 1,
        orderId: 1,
        productId: 1,
        title: 'A product',
        price_cents: 1200,
        quantity: 2,
        line_total: 2400,
        sellerId: 1,
        sellerName: 'A seller',
      },
    ],
    ...overrides,
  }
}
