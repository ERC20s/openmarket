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
    await getOrder(req, res)
  } catch (err) {
    console.error('GET /api/orders/[id] failed', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

async function getOrder(req: NextApiRequest, res: NextApiResponse) {
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // Expect URLs like /api/orders/om_0123456789abcdef01234567
  const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
  const parts = url.pathname.split('/')
  const reference = decodeURIComponent(parts[parts.length - 1] ?? '')

  if (!isOrderReference(reference)) {
    res.status(422).json({ error: 'Invalid reference' })
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

  const lines: QuoteLine[] = (Array.isArray(order.items) ? order.items : []).map((item: any) => ({
    productId: Number(item?.productId) || 0,
    title: typeof item?.title === 'string' ? item.title : `Product #${item?.productId ?? 0}`,
    price_cents: Number(item?.price_cents) || 0,
    quantity: Number(item?.quantity) || 0,
    line_total: Number(item?.line_total) || 0,
    sellerId: Number(item?.sellerId) || 0,
    sellerName: typeof item?.sellerName === 'string' ? item.sellerName : 'Unknown seller',
  }))

  res.status(200).json({
    reference: order.reference,
    status: order.status,
    total: typeof order.total_cents === 'number' ? order.total_cents : 0,
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
    createdAt: order.createdAt ?? null,
    lines,
    sellers: groupLinesBySeller(lines),
  })
}
