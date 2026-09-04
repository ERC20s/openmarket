import { randomBytes } from 'crypto'

import { NextApiRequest, NextApiResponse } from 'next'
import { PrismaClient } from '@prisma/client'

import { MAX_LINES, MAX_QUANTITY, MIN_QUANTITY } from '../../../lib/cart'
import { normalizeRequestedLines, priceQuote, readBody, requestedIds } from '../../../lib/quote'
import { INITIAL_ORDER_STATUS, newOrderReference } from '../../../lib/orders'

declare global {
  // Allow a single PrismaClient instance to be shared across module reloads in dev
  // eslint-disable-next-line no-var
  var __prisma?: PrismaClient
}

const prisma = (process.env.NODE_ENV === 'production')
  ? new PrismaClient()
  : (globalThis as any).__prisma ?? ((globalThis as any).__prisma = new PrismaClient())

// Placing the order. The body is the same { lines: [...] } the review page
// posted to /api/checkout, and it is priced again through the same lib/quote.ts
// helpers — so the buyer is charged what the review page showed, and a cart
// that moved in between is refused with 409 rather than quietly re-priced.
//
// Nothing is paid here: the order is written with status "pending"
// (lib/orders.ts owns what may happen to it next).

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    await placeOrder(req, res)
  } catch (err) {
    // Details stay in the server log; the client gets a stable JSON shape
    // instead of Next's HTML error page or a stack trace.
    console.error('POST /api/orders failed', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

async function placeOrder(req: NextApiRequest, res: NextApiResponse) {
  const parsed = normalizeRequestedLines(readBody(req))
  if ('error' in parsed) {
    res.status(422).json({ error: parsed.error })
    return
  }

  const rows = await prisma.product.findMany({
    where: { id: { in: requestedIds(parsed.requested) } },
    include: { seller: { select: { id: true, name: true } } },
  })

  const quote = priceQuote(parsed.requested, rows as any[])

  // Something moved between the review page and this click: a price changed or
  // a product was delisted. Do not decide for the buyer — hand the problems
  // back and let /checkout re-review them.
  if (quote.problems.length > 0) {
    res.status(409).json({
      error: 'The cart changed since it was reviewed',
      problems: quote.problems,
      lines: quote.lines,
      sellers: quote.sellers,
      total: quote.total,
      count: quote.count,
      limits: { maxLines: MAX_LINES, minQuantity: MIN_QUANTITY, maxQuantity: MAX_QUANTITY },
    })
    return
  }

  if (quote.lines.length === 0) {
    res.status(422).json({ error: 'Cart is empty' })
    return
  }

  // The random source is injected here, on the server, so lib/orders.ts stays
  // free of node builtins and can be imported by the confirmation page too.
  const reference = newOrderReference((bytes) => randomBytes(bytes).toString('hex'))

  // One nested create: the order and its items are written in a single
  // statement, so a half-written order cannot exist. Every item copies the
  // title, price and seller name it was bought at, so the order still reads
  // correctly after the product is renamed, re-priced or delisted.
  const created: any = await prisma.order.create({
    data: {
      reference,
      status: INITIAL_ORDER_STATUS,
      total_cents: quote.total,
      items: {
        create: quote.lines.map((line) => ({
          productId: line.productId,
          title: line.title,
          price_cents: line.price_cents,
          quantity: line.quantity,
          line_total: line.line_total,
          sellerId: line.sellerId,
          sellerName: line.sellerName,
        })),
      },
    },
    include: { items: true },
  })

  res.status(201).json({
    reference: (created && created.reference) || reference,
    status: (created && created.status) || INITIAL_ORDER_STATUS,
    total: quote.total,
    count: quote.count,
    lines: quote.lines,
    sellers: quote.sellers,
    createdAt: (created && created.createdAt) || null,
  })
}
