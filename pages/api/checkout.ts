import { NextApiRequest, NextApiResponse } from 'next'
import { PrismaClient } from '@prisma/client'

import { MAX_LINES, MAX_QUANTITY, MIN_QUANTITY } from '../../lib/cart'
import { normalizeRequestedLines, priceQuote, readBody, requestedIds } from '../../lib/quote'

declare global {
  // Allow a single PrismaClient instance to be shared across module reloads in dev
  // eslint-disable-next-line no-var
  var __prisma?: PrismaClient
}

const prisma = (process.env.NODE_ENV === 'production')
  ? new PrismaClient()
  : (globalThis as any).__prisma ?? ((globalThis as any).__prisma = new PrismaClient())

// The quote is priced from the database, never from the body. The pricing
// itself lives in lib/quote.ts, which POST /api/orders uses too — that is the
// point: the order is written at exactly the total this route quoted.

export type { QuoteLine, QuoteSeller, QuoteProblem } from '../../lib/quote'

import { apiRoute } from '../../lib/api'

export default apiRoute(async function handler(req: NextApiRequest, res: NextApiResponse) {
  await quoteCheckout(req, res)
}, { methods: ['POST'], name: 'POST /api/checkout' })

async function quoteCheckout(req: NextApiRequest, res: NextApiResponse) {
  const parsed = normalizeRequestedLines(readBody(req))
  if ('error' in parsed) {
    res.status(422).json({ error: parsed.error })
    return
  }

  // One query for the whole cart. The seller is narrowed to { id, name } by the
  // same include the read routes use, so no email column can reach the client.
  const rows = await prisma.product.findMany({
    where: { id: { in: requestedIds(parsed.requested) } },
    include: { seller: { select: { id: true, name: true } } },
  })

  const quote = priceQuote(parsed.requested, rows as any[])

  // No Order row is written and no payment is taken here: this is a quote.
  // Placing the order is POST /api/orders, which re-prices the same lines.
  res.status(200).json({
    lines: quote.lines,
    sellers: quote.sellers,
    total: quote.total,
    count: quote.count,
    problems: quote.problems,
    limits: { maxLines: MAX_LINES, minQuantity: MIN_QUANTITY, maxQuantity: MAX_QUANTITY },
  })
}
