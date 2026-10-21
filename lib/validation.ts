// Request validation for every API route, in one place.
//
// Each route hands its query, path id or body to a zod schema here and answers
// 400 { error } when it does not parse — before any database call — so junk
// input can never reach Prisma and come back as a 500. The error text is the
// first issue's message, which keeps the short reasons the pages already show
// ('Invalid id', 'Cart is empty', ...).

import type { NextApiResponse } from 'next'
import { z } from 'zod'

import { MAX_LINES, MAX_QUANTITY, MIN_QUANTITY } from './cart'
import { MAX_ID, MAX_PAGE, MAX_Q_LENGTH, MAX_SIZE } from './products-query'
import { ORDER_REFERENCE_PATTERN } from './orders'

/** Largest id a SQLite INTEGER primary key in this schema is asked for (shared with the storefront). */
export { MAX_ID }
export const MAX_TITLE_LENGTH = 200
export const MAX_DESCRIPTION_LENGTH = 5_000
export const MAX_SELLER_NAME_LENGTH = 100
/** $100,000.00 — a price above this is a typo, not a product. */
export const MAX_PRICE_CENTS = 10_000_000

/** A whole number written in decimal digits only: no sign, no '1e3', no '1.0', no spaces. */
function digits(message: string, min: number, max: number) {
  return z
    .string({ error: message })
    .regex(/^\d{1,10}$/, { error: message })
    .transform(Number)
    .pipe(z.number().int().min(min, { error: message }).max(max, { error: message }))
}

/** An integer that may arrive as a JSON number or as a digit string (a hand-rolled form post). */
function wholeNumber(message: string, min: number, max: number) {
  return z.union(
    [z.number({ error: message }), z.string({ error: message }).regex(/^\d{1,10}$/, { error: message }).transform(Number)],
    { error: message }
  ).pipe(z.number().int({ error: message }).min(min, { error: message }).max(max, { error: message }))
}

export const idParam = digits('Invalid id', 1, MAX_ID)

export const referenceParam = z.string({ error: 'Invalid reference' }).regex(ORDER_REFERENCE_PATTERN, {
  error: 'Invalid reference',
})

export const paginationQuery = z.object({
  page: digits('Invalid page or size', 1, MAX_PAGE).default(1),
  size: digits('Invalid page or size', 1, MAX_SIZE).default(20),
})

export const productsQuery = paginationQuery.extend({
  q: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(MAX_Q_LENGTH, { error: 'Invalid query' }))
    .default(''),
  sellerId: digits('Invalid sellerId', 1, MAX_ID).optional(),
})

const cartLine = z.object(
  {
    productId: wholeNumber('Invalid productId', 1, MAX_ID),
    quantity: wholeNumber('Invalid quantity', MIN_QUANTITY, MAX_QUANTITY).default(MIN_QUANTITY),
    // A claim, never charged (lib/quote.ts): null or absent means "no claim".
    price_cents: wholeNumber('Invalid price_cents', 0, MAX_PRICE_CENTS).nullable().default(null),
  },
  { error: 'Invalid line' }
)

export const cartBody = z.object(
  {
    lines: z
      .array(cartLine, { error: 'Invalid lines' })
      .min(1, { error: 'Cart is empty' })
      .max(MAX_LINES, { error: 'Too many lines' }),
  },
  { error: 'Invalid lines' }
)

const title = z.string({ error: 'Invalid title' }).trim().min(1, { error: 'Invalid title' }).max(MAX_TITLE_LENGTH, {
  error: 'Invalid title',
})
const description = z.string({ error: 'Invalid description' }).max(MAX_DESCRIPTION_LENGTH, {
  error: 'Invalid description',
})
const priceCents = z
  .number({ error: 'Invalid price_cents' })
  .int({ error: 'Invalid price_cents' })
  .min(0, { error: 'Invalid price_cents' })
  .max(MAX_PRICE_CENTS, { error: 'Invalid price_cents' })

export const productCreateBody = z.strictObject(
  { title, description: description.default(''), price_cents: priceCents },
  { error: 'Invalid product' }
)

export const productUpdateBody = z
  .strictObject({ title: title.optional(), description: description.optional(), price_cents: priceCents.optional() }, {
    error: 'Invalid product',
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), { error: 'Nothing to update' })

export const storefrontUpdateBody = z.strictObject(
  {
    name: z.string({ error: 'Invalid name' }).trim().min(1, { error: 'Invalid name' }).max(MAX_SELLER_NAME_LENGTH, {
      error: 'Invalid name',
    }),
  },
  { error: 'Invalid storefront' }
)

export const orderStatusBody = z.object(
  { status: z.string({ error: 'Invalid target status' }).max(32, { error: 'Invalid target status' }) },
  { error: 'Invalid target status' }
)

/** Parse or say why not — the same { error } | { data } shape normalizeRequestedLines uses. */
export function check<S extends z.ZodType>(schema: S, input: unknown): { data: z.output<S> } | { error: string } {
  const result = schema.safeParse(input)
  if (result.success) return { data: result.data }
  return { error: result.error.issues[0]?.message ?? 'Invalid request' }
}

/** Parse, or answer 400 { error } and give back undefined. */
export function parseOr400<S extends z.ZodType>(res: NextApiResponse, schema: S, input: unknown): z.output<S> | undefined {
  const result = check(schema, input)
  if ('error' in result) {
    res.status(400).json({ error: result.error })
    return undefined
  }
  return result.data
}

/**
 * The request URL, parsed against a fixed base. The Host header is client
 * input: building the URL from it lets a junk Host turn into a thrown TypeError
 * (a 500) — and the routes only ever read the path and the query.
 */
export function requestUrl(req: { url?: string }): URL {
  try {
    return new URL(req.url ?? '/', 'http://openmarket.invalid')
  } catch {
    return new URL('/', 'http://openmarket.invalid')
  }
}

/** The named query params, first value wins; absent ones stay undefined so defaults apply. */
export function queryOf(url: URL, keys: readonly string[]): Record<string, string | undefined> {
  const query: Record<string, string | undefined> = {}
  for (const key of keys) query[key] = url.searchParams.get(key) ?? undefined
  return query
}

/** Path segment `fromEnd` places from the end (0 = last), percent-decoded, or undefined if it cannot be. */
export function pathSegment(url: URL, fromEnd = 0): string | undefined {
  const parts = url.pathname.split('/')
  // A trailing slash leaves an empty last part: '/api/orders/' has no reference.
  const raw = parts[parts.length - 1 - fromEnd]
  if (raw === undefined) return undefined
  try {
    return decodeURIComponent(raw)
  } catch {
    return undefined
  }
}
