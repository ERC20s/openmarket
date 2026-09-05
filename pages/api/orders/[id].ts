import { NextApiRequest, NextApiResponse } from 'next'
import { PrismaClient } from '@prisma/client'

import { groupLinesBySeller, type QuoteLine } from '../../../lib/quote'
import { isOrderReference } from '../../../lib/orders'

declare global {
  // Allow a single PrismaClient instance to be shared across module reloads in dev
  // eslint-disable-next-line no-var
  var __prisma?: PrismaClient
}

const prisma = (process.env.NODE_ENV === 'production')
  ? new PrismaClient()
  : (globalThis as any).__prisma ?? ((globalThis as any).__prisma = new PrismaClient())

// Reading one order back, by its public reference — never by the row id, so
// nobody can walk /api/orders/1, /api/orders/2 through other people's orders.
// The reference is an unguessable token, not authentication: this route returns
// only what was bought, and the Order model holds no buyer contact detail at
// all, exactly as the seller routes never return a seller's email.

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await handleOrder(req, res)
  } catch (err) {
    console.error('GET/PATCH /api/orders/[id] failed', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

async function handleOrder(req: NextApiRequest, res: NextApiResponse) {
  // Expect URLs like /api/orders/om_0123456789abcdef01234567
  const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
  const parts = url.pathname.split('/')
  const reference = decodeURIComponent(parts[parts.length - 1] ?? '')

  if (!isOrderReference(reference)) {
    res.status(422).json({ error: 'Invalid reference' })
    return
  }

  // Reusable serializer: both GET and PATCH must return the same shape.
  async function serialize(order: any) {
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

  if (req.method === 'GET' || !req.method) {
    if (req.method && req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      res.status(405).json({ error: 'Method not allowed' })
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

    res.status(200).json(await serialize(order))
    return
  }

  if (req.method === 'PATCH') {
    // Only accept PATCH for now; other verbs are refused below.
    const body = req.body
    const target = body && typeof body === 'object' ? (body as { status?: unknown }).status : undefined

    if (!target || typeof target !== 'string') {
      res.status(422).json({ error: 'Invalid target status' })
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

    // Only allow the buyer-limited transitions here: e.g. pending -> cancelled.
    // Defer paid/shipped/delivered to a signed-in seller dashboard.
    const { applyTransition } = await import('../../../lib/orders')
    const { buyerNextStatuses } = await import('../../../lib/orders')

    // Validate the target is something this API accepts.
    const allowed = buyerNextStatuses(order.status)
    if (!Array.isArray(allowed) || !allowed.includes(target as any)) {
      // Distinguish unknown status from refused move to match existing testing
      // style: a target that is not a valid status is 422, a refused move is 409.
      const { isOrderStatus } = await import('../../../lib/orders')
      if (!isOrderStatus(target)) {
        res.status(422).json({ error: 'Invalid target status' })
        return
      }
      res.status(409).json({ error: `Order cannot move from ${order.status} to ${target}` })
      return
    }

    const result = applyTransition(order.status, target)
    if (!result.ok) {
      res.status(409).json({ error: result.error })
      return
    }

    const updated: any = await prisma.order.update({ where: { reference }, data: { status: result.status } })
    res.status(200).json(await serialize(updated))
    return
  }

  // Any other method.
  res.setHeader('Allow', 'GET, PATCH')
  res.status(405).json({ error: 'Method not allowed' })
}
