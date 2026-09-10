import { NextApiRequest, NextApiResponse } from 'next'
import { PrismaClient } from '@prisma/client'

declare global {
  // eslint-disable-next-line no-var
  var __prisma?: PrismaClient
}

const prisma = (process.env.NODE_ENV === 'production')
  ? new PrismaClient()
  : (globalThis as any).__prisma ?? ((globalThis as any).__prisma = new PrismaClient())

// A read-only, per-seller view of the orders that touched their products.
// OrderItem already snapshots sellerId/sellerName at the moment an order is
// placed (prisma/schema.prisma), so this needs no schema change: it groups
// that seller's own lines back into their orders.
//
// This is deliberately reference-free: pages/orders/[id].tsx treats the order
// reference as "not authentication" for a buyer who was handed it once, but
// this page is public and indexed by seller id, so printing the reference
// here would let anyone browse to it and discover a cancel-capable token for
// an order they never placed. Only status, createdAt, this seller's own
// lines and their subtotal are returned — never another seller's lines from
// the same order, and never the raw order id or reference.

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await getSellerOrders(req, res)
  } catch (err) {
    console.error('GET /api/sellers/[id]/orders failed', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

async function getSellerOrders(req: NextApiRequest, res: NextApiResponse) {
  // Expect URLs like /api/sellers/4/orders
  const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
  const parts = url.pathname.split('/').filter(Boolean)
  const idPart = parts[parts.length - 2]
  const id = parseInt(idPart, 10)

  if (Number.isNaN(id) || id < 1) {
    res.status(422).json({ error: 'Invalid id' })
    return
  }

  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const pageRaw = url.searchParams.get('page')
  const sizeRaw = url.searchParams.get('size')

  const { page, size, skip, error } = require('../../../../lib/pagination').parsePageSize(pageRaw, sizeRaw)
  if (error) {
    res.status(422).json({ error })
    return
  }

  // Same seller shape every other seller route ships: id and name only.
  const seller = await prisma.seller.findUnique({
    where: { id },
    select: { id: true, name: true },
  })
  if (!seller) {
    res.status(404).json({ error: 'Seller not found' })
    return
  }

  // Step 1: which orders this seller's lines belong to, newest order first.
  // Paginate at the order level, not the line level, so a multi-line order
  // never straddles two pages.
  const distinctItems: { orderId: number }[] = await prisma.orderItem.findMany({
    where: { sellerId: id },
    distinct: ['orderId'],
    select: { orderId: true },
    orderBy: { order: { createdAt: 'desc' } },
  })

  const total = distinctItems.length
  const pageOrderIds = distinctItems.slice(skip, skip + size).map((row) => row.orderId)

  // Step 2: this seller's own lines for exactly those orders — never a line
  // belonging to another seller on a shared order.
  const items: any[] = pageOrderIds.length
    ? await prisma.orderItem.findMany({
        where: { sellerId: id, orderId: { in: pageOrderIds } },
        include: { order: { select: { status: true, createdAt: true } } },
      })
    : []

  const byOrderId = new Map<
    number,
    { status: string; createdAt: unknown; lines: { title: string; price_cents: number; quantity: number; line_total: number }[]; subtotal: number }
  >()

  for (const item of items) {
    const key = Number(item.orderId)
    if (!byOrderId.has(key)) {
      byOrderId.set(key, {
        status: item.order?.status ?? 'unknown',
        createdAt: item.order?.createdAt ?? null,
        lines: [],
        subtotal: 0,
      })
    }
    const entry = byOrderId.get(key)!
    entry.lines.push({
      title: typeof item.title === 'string' ? item.title : `Product #${item.productId ?? 0}`,
      price_cents: Number(item.price_cents) || 0,
      quantity: Number(item.quantity) || 0,
      line_total: Number(item.line_total) || 0,
    })
    entry.subtotal += Number(item.line_total) || 0
  }

  // Keep the newest-order-first order Step 1 already established.
  const orders = pageOrderIds.map((orderId) => byOrderId.get(orderId)).filter(Boolean)

  res.status(200).json({ seller, orders, total, page, size })
}
