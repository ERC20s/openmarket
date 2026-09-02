/**
 * An in-memory stand-in for the generated Prisma client.
 *
 * The API handlers under pages/api/ do `const prisma = new PrismaClient()` at
 * module scope, so a test that imports a handler would otherwise open the real
 * sqlite database (prisma/dev.db) and need `prisma generate` + `prisma migrate`
 * before it can even start. Each test file mocks '@prisma/client' with the
 * PrismaClient exported here instead, so the suite is hermetic: no database,
 * no seeding, no writes to anyone's dev.db.
 *
 * Only the query shapes the handlers actually use are implemented:
 *   product.count({ where })
 *   product.findMany({ skip, take, where, orderBy, include })
 *   product.findUnique({ where: { id }, include })
 *   seller.findUnique({ where: { id } })
 *   seller.findFirst({ where })
 * Anything else throws, loudly, so a handler that starts using a new query is
 * not silently tested against nothing.
 */

export interface StubSeller {
  id: number
  name: string
  email: string
}

export interface StubProduct {
  id: number
  title: string
  description: string
  price_cents: number
  sellerId: number
  createdAt: Date
}

/** Ids that are guaranteed NOT to be in the fixture — used for the 404 cases. */
export const MISSING_PRODUCT_ID = 99999999
export const MISSING_SELLER_ID = 99999999

export const FIXTURE_PRODUCT_COUNT = 25

function baseSellers(): StubSeller[] {
  return [
    { id: 1, name: 'Acme Supply', email: 'acme@example.test' },
    { id: 2, name: 'Borealis Goods', email: 'borealis@example.test' },
  ]
}

function baseProducts(): StubProduct[] {
  const list: StubProduct[] = []
  for (let i = 1; i <= FIXTURE_PRODUCT_COUNT; i++) {
    list.push({
      id: i,
      title: `Fixture product ${i}`,
      description: `Description for fixture product ${i}`,
      price_cents: 1000 + i * 25,
      // seller 1 gets the odd ids (13 products), seller 2 the even ids (12)
      sellerId: i % 2 === 0 ? 2 : 1,
      // a higher id is newer, so `orderBy: { createdAt: 'desc' }` is id 25 first
      createdAt: new Date(Date.UTC(2024, 0, 1, 0, 0, i)),
    })
  }
  return list
}

let sellers: StubSeller[] = baseSellers()
let products: StubProduct[] = baseProducts()

/** The fixture as the handlers should see it, newest first. */
export function fixtureProductsNewestFirst(): StubProduct[] {
  return products.slice().sort(compareBy([{ createdAt: 'desc' }]))
}

export function fixtureSellers(): StubSeller[] {
  return sellers.slice()
}

type OrderBy = Record<string, 'asc' | 'desc'>

function normaliseOrderBy(orderBy: OrderBy | OrderBy[] | undefined): OrderBy[] {
  if (!orderBy) return []
  return Array.isArray(orderBy) ? orderBy : [orderBy]
}

function valueOf(row: any, field: string): number {
  const v = row[field]
  return v instanceof Date ? v.getTime() : v
}

function compareBy(orderBy: OrderBy[]) {
  return (a: any, b: any) => {
    for (const clause of orderBy) {
      for (const field of Object.keys(clause)) {
        const dir = clause[field] === 'desc' ? -1 : 1
        const av = valueOf(a, field)
        const bv = valueOf(b, field)
        if (av < bv) return -1 * dir
        if (av > bv) return 1 * dir
      }
    }
    return 0
  }
}

function matches(row: any, where: Record<string, any> | undefined): boolean {
  if (!where) return true
  return Object.keys(where).every((field) => {
    const expected = (where as any)[field]
    // `{ products: { some: {} } }` — relation filter used by seller.findFirst
    if (field === 'products' && expected && typeof expected === 'object') {
      return products.some((p) => p.sellerId === row.id)
    }
    return row[field] === expected
  })
}

/** Prisma returns fresh objects; hand out copies so a test cannot mutate the fixture. */
function withSeller(product: StubProduct, include: any) {
  const copy: any = { ...product }
  if (include && include.seller) {
    const seller = sellers.find((s) => s.id === product.sellerId)
    copy.seller = seller ? { id: seller.id, name: seller.name } : null
  }
  return copy
}

export const prismaStub = {
  product: {
    async count(args: { where?: Record<string, any> } = {}) {
      return products.filter((p) => matches(p, args.where)).length
    },
    async findMany(
      args: { skip?: number; take?: number; where?: Record<string, any>; orderBy?: OrderBy | OrderBy[]; include?: any } = {},
    ) {
      let rows = products.filter((p) => matches(p, args.where))
      const orderBy = normaliseOrderBy(args.orderBy)
      if (orderBy.length) rows = rows.slice().sort(compareBy(orderBy))
      const skip = args.skip ?? 0
      const take = args.take ?? rows.length
      return rows.slice(skip, skip + take).map((p) => withSeller(p, args.include))
    },
    async findUnique(args: { where: { id: number }; include?: any }) {
      const found = products.find((p) => p.id === args.where.id)
      return found ? withSeller(found, args.include) : null
    },
    async findFirst(args: { where?: Record<string, any>; include?: any } = {}) {
      const found = products.find((p) => matches(p, args.where))
      return found ? withSeller(found, args.include) : null
    },
  },
  seller: {
    async count(args: { where?: Record<string, any> } = {}) {
      return sellers.filter((s) => matches(s, args.where)).length
    },
    async findUnique(args: { where: { id: number } }) {
      const found = sellers.find((s) => s.id === args.where.id)
      return found ? { ...found } : null
    },
    async findFirst(args: { where?: Record<string, any> } = {}) {
      const found = sellers.find((s) => matches(s, args.where))
      return found ? { ...found } : null
    },
    async findMany(args: { where?: Record<string, any> } = {}) {
      return sellers.filter((s) => matches(s, args.where)).map((s) => ({ ...s }))
    },
  },
  async $connect() {
    /* no database to connect to */
  },
  async $disconnect() {
    /* no database to disconnect from */
  },
}

/** Put the fixture back the way it started. Call it in beforeEach. */
export function resetPrismaStub() {
  sellers = baseSellers()
  products = baseProducts()
}

/**
 * Drop-in replacement for the generated client's constructor: every instance
 * shares the one in-memory fixture, which is what the handlers' module-scope
 * `new PrismaClient()` needs.
 */
export class PrismaClientStub {
  constructor(_options?: unknown) {
    return prismaStub as any
  }
}

/** What a `vi.mock('@prisma/client', ...)` factory should return. */
export function prismaClientModuleStub() {
  return { PrismaClient: PrismaClientStub, prismaStub, resetPrismaStub }
}
