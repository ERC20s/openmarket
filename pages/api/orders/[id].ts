import { NextApiRequest, NextApiResponse } from 'next'
import { PrismaClient } from '@prisma/client'

import { groupLinesBySeller, type QuoteLine } from '../../../lib/quote'

declare global {
  // Allow a single PrismaClient instance to be shared across module reloads in dev
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

const prisma = (process.env.NODE_ENV === 'production')
  ? new PrismaClient()
  : (globalThis as any).__prisma ?? ((globalThis as any).__prisma = new PrismaClient())

// Reading one order back, by its public reference — never by the row id, so
// nobody can walk /api/orders/1, /api/orders/2 through other people's orders.
// The reference is an unguessable token for *reading*: this route returns only
// what was bought, and the Order model holds no buyer contact detail at all,
// exactly as the seller routes never return a seller's email. *Changing* an
// order needs more than the reference: the buyer cookie it was placed with
// (lib/auth.ts), so a reference that leaks cannot be used to cancel the order.

import { apiRoute } from '../../../lib/api'
import { FORBIDDEN, UNAUTHENTICATED, buyerToken, hashToken, sameHash } from '../../../lib/auth'
import { applyTransition, buyerNextStatuses, isOrderStatus } from '../../../lib/orders'
import { readBody } from '../../../lib/quote'
import { orderStatusBody, parseOr400, pathSegment, referenceParam, requestUrl } from '../../../lib/validation'

export default apiRoute(async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Expect URLs like /api/orders/om_0123456789abcdef01234567
  const reference = parseOr400(res, referenceParam, pathSegment(requestUrl(req)))
  if (reference === undefined) return

  if (req.method === 'PATCH') {
    await changeOrder(req, res, reference)
    return
  }
  await getOrder(res, reference)
}, { methods: ['GET', 'PATCH'], name: 'GET/PATCH /api/orders/[id]' })

// Both GET and PATCH return the same shape. The buyer token hash is never part of it.
function serialize(order: any) {
  const lines: QuoteLine[] = (Array.isArray(order.items) ? order.items : []).map((item: any) => ({
    productId: Number(item?.productId) || 0,
    title: typeof item?.title === 'string' ? item.title : `Product #${item?.productId ?? 0}`,
    price_cents: Number(item?.price_cents) || 0,
    quantity: Number(item?.quantity) || 0,
    line_total: Number(item?.line_total) || 0,
    sellerId: Number(item?.sellerId) || 0,
    sellerName: typeof item?.sellerName === 'string' ? item.sellerName : 'Unknown seller',
  }))

  return {
    reference: order.reference,
    status: order.status,
    total: typeof order.total_cents === 'number' ? order.total_cents : 0,
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
    createdAt: order.createdAt ?? null,
    lines,
    sellers: groupLinesBySeller(lines),
  }
}

async function getOrder(res: NextApiResponse, reference: string) {
  const order: any = await prisma.order.findUnique({
    where: { reference },
    include: { items: true },
  })

  if (!order) {
    res.status(404).json({ error: 'Order not found' })
    return
  }

  res.status(200).json(serialize(order))
}

async function changeOrder(req: NextApiRequest, res: NextApiResponse, reference: string) {
  const buyer = buyerToken(req)
  if (!buyer) {
    res.status(401).json(UNAUTHENTICATED)
    return
  }

  const body = parseOr400(res, orderStatusBody, readBody(req))
  if (!body) return
  const target = body.status
  if (!isOrderStatus(target)) {
    res.status(400).json({ error: 'Invalid target status' })
    return
  }

  const order: any = await prisma.order.findUnique({
    where: { reference },
    include: { items: true },
  })

  if (!order) {
    res.status(404).json({ error: 'Order not found' })
    return
  }

  // Not this browser's order. An order placed before buyer cookies existed has
  // no hash at all, and so matches nobody: it fails closed.
  if (!sameHash(order.buyerTokenHash, hashToken(buyer))) {
    res.status(403).json(FORBIDDEN)
    return
  }

  // Only the buyer-limited transitions here: pending -> cancelled. paid,
  // shipped and delivered belong to the seller side.
  if (!buyerNextStatuses(order.status).includes(target)) {
    res.status(409).json({ error: `Order cannot move from ${order.status} to ${target}` })
    return
  }

  const result = applyTransition(order.status, target)
  if (!result.ok) {
    res.status(409).json({ error: result.error })
    return
  }

  const updated: any = await prisma.order.update({ where: { reference }, data: { status: result.status }, include: { items: true } })
  res.status(200).json(serialize(updated))
}
