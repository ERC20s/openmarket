import { NextApiRequest, NextApiResponse } from 'next'
import { PrismaClient } from '@prisma/client'

import { MAX_LINES, MAX_QUANTITY, MIN_QUANTITY, clampQuantity } from '../../lib/cart'

declare global {
  // Allow a single PrismaClient instance to be shared across module reloads in dev
  // eslint-disable-next-line no-var
  var __prisma?: PrismaClient
}

const prisma = (process.env.NODE_ENV === 'production')
  ? new PrismaClient()
  : (globalThis as any).__prisma ?? ((globalThis as any).__prisma = new PrismaClient())

// The quote is priced from the database, never from the body. A cart line is a
// snapshot taken when the product was added (lib/cart.ts says so in its header),
// so the client's price_cents is treated as a *claim*: it is compared with the
// stored price and reported back as a problem when the two disagree, but it is
// never what the buyer is charged.

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // The mirror image of the GET-only guard on the read routes: a quote changes
  // nothing but it carries a body, so this route is POST-only and a GET gets
  // 405 JSON instead of an empty quote.
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    await quoteCheckout(req, res)
  } catch (err) {
    // Details stay in the server log; the client gets a stable JSON shape
    // instead of Next's HTML error page or a stack trace.
    console.error('POST /api/checkout failed', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

/** What one requested line looks like once it has been checked. */
type RequestedLine = { productId: number; quantity: number; claimedPrice: number | null }

function toInt(value: unknown): number | null {
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
function readBody(req: NextApiRequest): any {
  const body: any = (req as any).body
  if (typeof body !== 'string') return body
  if (body.trim() === '') return null
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

async function quoteCheckout(req: NextApiRequest, res: NextApiResponse) {
  const body = readBody(req)
  const rawLines = body && typeof body === 'object' ? (body as { lines?: unknown }).lines : undefined

  if (!Array.isArray(rawLines)) {
    res.status(422).json({ error: 'Invalid lines' })
    return
  }
  if (rawLines.length === 0) {
    res.status(422).json({ error: 'Cart is empty' })
    return
  }
  // The same ceiling lib/cart.ts enforces in the browser: a body with ten
  // thousand lines is an attack or a bug, not a shopping trip.
  if (rawLines.length > MAX_LINES) {
    res.status(422).json({ error: 'Too many lines' })
    return
  }

  const requested: RequestedLine[] = []
  for (const raw of rawLines) {
    if (!raw || typeof raw !== 'object') {
      res.status(422).json({ error: 'Invalid line' })
      return
    }

    const productId = toInt((raw as any).productId)
    if (productId === null || productId < 1) {
      res.status(422).json({ error: 'Invalid productId' })
      return
    }

    // Junk quantities are clamped, not rejected — exactly what clampQuantity
    // does for the cart page, so a stuck spinner cannot 422 a real cart.
    const quantity = clampQuantity((raw as any).quantity)
    const claimedPrice = toInt((raw as any).price_cents)

    // A repeat of the same product merges, the way addLine merges in the cart.
    const existing = requested.find((line) => line.productId === productId)
    if (existing) {
      existing.quantity = clampQuantity(existing.quantity + quantity)
      if (existing.claimedPrice === null) existing.claimedPrice = claimedPrice
      continue
    }

    requested.push({ productId, quantity, claimedPrice })
  }

  const ids = requested.map((line) => line.productId)

  // One query for the whole cart. The seller is narrowed to { id, name } by the
  // same include the read routes use, so no email column can reach the client.
  const rows = await prisma.product.findMany({
    where: { id: { in: ids } },
    include: { seller: { select: { id: true, name: true } } },
  })

  const found = new Map<number, any>()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row && typeof row.id === 'number') found.set(row.id, row)
  }

  const lines: QuoteLine[] = []
  const problems: QuoteProblem[] = []

  for (const line of requested) {
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

  // Grouped by seller in first-seen order, the way groupBySeller does it on
  // /cart, so the review page reads the same as the cart it came from.
  const sellers: QuoteSeller[] = []
  for (const line of lines) {
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

  const total = lines.reduce((sum, line) => sum + line.line_total, 0)
  const count = lines.reduce((sum, line) => sum + line.quantity, 0)

  // No Order row is written and no payment is taken: this is a quote, and the
  // order state machine is a later change.
  res.status(200).json({
    lines,
    sellers,
    total,
    count,
    problems,
    limits: { maxLines: MAX_LINES, minQuantity: MIN_QUANTITY, maxQuantity: MAX_QUANTITY },
  })
}
