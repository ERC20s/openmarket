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
    findUnique: vi.fn(),
  },
}

export class PrismaClientMock {
  product = prismaSpies.product
  seller = prismaSpies.seller
  $connect = async () => {}
  $disconnect = async () => {}
}

// Call in beforeEach: forget previous calls and hand back the neutral answers
// (nothing found, nothing counted) so a test only states what it cares about.
export function resetPrismaSpies() {
  prismaSpies.product.count.mockReset().mockResolvedValue(0)
  prismaSpies.product.findMany.mockReset().mockResolvedValue([])
  prismaSpies.product.findUnique.mockReset().mockResolvedValue(null)
  prismaSpies.seller.findUnique.mockReset().mockResolvedValue(null)
}

// The request/response doubles that used to be copy-pasted into every test
// file. Deliberately untyped at the edges: `next` is a peer of the handlers,
// and the tests only need the three members the handlers touch.
export function mockReq(url: string, method = 'GET'): any {
  return {
    url,
    method,
    headers: { host: 'localhost' },
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
