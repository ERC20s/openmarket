// Pricing a cart, as data. Everything here used to live inside
// pages/api/checkout.ts; it moved out so that POST /api/orders charges exactly
// what the /checkout review page showed — one implementation, two routes.
//
// No React, no Prisma and no next import: the caller does the database read and
// hands the rows in, the same way lib/cart.ts stays a pure function over an
// array of lines. That keeps this file unit-testable and keeps the "the price
// comes from the database, never from the body" rule in one place.
//
// A cart line is a snapshot taken when the product was added (lib/cart.ts says
// so in its header), so the client's price_cents is treated as a *claim*: it is
// compared with the stored price and reported back as a problem, but it is
// never what the buyer is charged.

import { clampQuantity } from './cart'
import { cartBody, check } from './validation'

/** One priced line, as the server sees it. */
export type QuoteLine = {
  productId: number
  title: string
  price_cents: number
  quantity: number
  line_total: number
  sellerId: number
  sellerName: string
}

/** One seller's slice of the quote — this marketplace sells for many at once. */
export type QuoteSeller = {
  sellerId: number
  sellerName: string
  lines: QuoteLine[]
  subtotal: number
}

/** Something the buyer has to be told before they pay. */
export type QuoteProblem =
  | { code: 'product_missing'; productId: number; message: string }
  | { code: 'price_changed'; productId: number; was: number; now: number; message: string }

/** What one requested line looks like once it has been checked. */
export type RequestedLine = { productId: number; quantity: number; claimedPrice: number | null }

/** The whole priced answer, before a route wraps it in JSON. */
export type Quote = {
  lines: QuoteLine[]
  sellers: QuoteSeller[]
  total: number
  count: number
  problems: QuoteProblem[]
}

export function toInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) return null
  if (typeof value === 'number' && !Number.isInteger(value)) return null
  return Math.trunc(parsed)
}

/**
 * Next.js parses a JSON body for us, but a hand-rolled fetch (or a test) can
 * hand in the raw string, so accept both rather than 500 on a string body.
 */
export function readBody(req: { body?: unknown }): any {
  const body: any = (req as any).body
  if (typeof body !== 'string') return body
  if (body.trim() === '') return null
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

/**
 * Turn the posted body into requested lines, or say which 400 to answer.
 *
 * The shape, the id and the 1..99 quantity range are checked by the zod schema
 * in lib/validation.ts — the same 1..99 the cart page clamps to, so a real cart
 * never trips it. A repeated productId merges the way addLine merges in the
 * cart, and only that merged total is clamped back to 99.
 */
export function normalizeRequestedLines(
  body: unknown
): { error: string } | { requested: RequestedLine[] } {
  const parsed = check(cartBody, body)
  if ('error' in parsed) return parsed

  const requested: RequestedLine[] = []
  for (const line of parsed.data.lines) {
    const existing = requested.find((entry) => entry.productId === line.productId)
    if (existing) {
      existing.quantity = clampQuantity(existing.quantity + line.quantity)
      if (existing.claimedPrice === null) existing.claimedPrice = line.price_cents
      continue
    }

    requested.push({ productId: line.productId, quantity: line.quantity, claimedPrice: line.price_cents })
  }

  return { requested }
}

/** The ids to look up, in first-seen order — what the route passes to findMany. */
export function requestedIds(requested: RequestedLine[]): number[] {
  return requested.map((line) => line.productId)
}

/** One line of the body POST /api/orders takes: the id, the quantity and the price claim. */
export type OrderRequestLine = { productId: number; quantity: number; price_cents: number }

/**
 * The body the review page posts to POST /api/orders once the buyer has seen
 * a quote: the quoted lines, each claiming the price the quote showed.
 *
 * It is built from the quote, never from the cart snapshot, because the
 * snapshot is exactly what the quote corrected: a line whose price moved
 * would re-send the old price as its claim, the server would answer 409 again,
 * and the buyer could never place the order. A product the quote dropped as
 * missing is not in the quote's lines, so it is not asked for either. If the
 * price moves again between the review and the click the claim is stale once
 * more and the server still answers 409 — that is the check doing its job.
 */
export function orderRequestFromQuote(quote: { lines: QuoteLine[] }): { lines: OrderRequestLine[] } {
  const lines = Array.isArray(quote?.lines) ? quote.lines : []
  return {
    lines: lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      price_cents: line.price_cents,
    })),
  }
}

/**
 * Group priced lines by seller in first-seen order, the way groupBySeller does
 * it on /cart, so every page reads the same as the cart it came from.
 */
export function groupLinesBySeller(lines: QuoteLine[]): QuoteSeller[] {
  const sellers: QuoteSeller[] = []
  for (const line of Array.isArray(lines) ? lines : []) {
    const existing = sellers.find((group) => group.sellerId === line.sellerId)
    if (existing) {
      existing.lines.push(line)
      existing.subtotal += line.line_total
      continue
    }
    sellers.push({
      sellerId: line.sellerId,
      sellerName: line.sellerName,
      lines: [line],
      subtotal: line.line_total,
    })
  }
  return sellers
}

/**
 * Price the requested lines against the rows the route read from the database.
 * `rows` are Product rows with the seller narrowed to { id, name } by the same
 * include the read routes use, so no email column can reach the client.
 */
export function priceQuote(requested: RequestedLine[], rows: any[]): Quote {
  const found = new Map<number, any>()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row && typeof row.id === 'number') found.set(row.id, row)
  }

  const lines: QuoteLine[] = []
  const problems: QuoteProblem[] = []

  for (const line of Array.isArray(requested) ? requested : []) {
    const row = found.get(line.productId)

    if (!row) {
      // Delisted while it sat in the cart: name it and drop it from the total
      // rather than pricing a product that no longer exists.
      problems.push({
        code: 'product_missing',
        productId: line.productId,
        message: `Product #${line.productId} is no longer available and was removed from this order.`,
      })
      continue
    }

    const price = toInt(row.price_cents) ?? 0
    const sellerId = toInt(row.sellerId ?? row.seller?.id) ?? 0
    const sellerName = typeof row.seller?.name === 'string' && row.seller.name.trim() !== ''
      ? row.seller.name.trim()
      : sellerId > 0
        ? `Seller #${sellerId}`
        : 'Unknown seller'
    const title = typeof row.title === 'string' && row.title.trim() !== ''
      ? row.title.trim()
      : `Product #${line.productId}`

    if (line.claimedPrice !== null && line.claimedPrice !== price) {
      problems.push({
        code: 'price_changed',
        productId: line.productId,
        was: line.claimedPrice,
        now: price,
        message: `The price of ${title} changed while it was in the cart.`,
      })
    }

    lines.push({
      productId: line.productId,
      title,
      price_cents: price,
      quantity: line.quantity,
      line_total: price * line.quantity,
      sellerId,
      sellerName,
    })
  }

  return {
    lines,
    sellers: groupLinesBySeller(lines),
    total: lines.reduce((sum, line) => sum + line.line_total, 0),
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
    problems,
  }
}
