import { NextApiRequest, NextApiResponse } from 'next'
import { PrismaClient } from '@prisma/client'

declare global {
  // Allow a single PrismaClient instance to be shared across module reloads in dev
  // eslint-disable-next-line no-var
  var __prisma?: PrismaClient
}

const prisma = (process.env.NODE_ENV === 'production')
  ? new PrismaClient()
  : (globalThis as any).__prisma ?? ((globalThis as any).__prisma = new PrismaClient())

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
  const pageRaw = url.searchParams.get('page') ?? '1'
  const sizeRaw = url.searchParams.get('size') ?? '20'

  const page = parseInt(pageRaw, 10)
  const size = parseInt(sizeRaw, 10)

  if (Number.isNaN(page) || page < 1 || Number.isNaN(size) || size < 1 || size > 100) {
    res.status(422).json({ error: 'Invalid page or size' })
    return
  }

  const qRaw = url.searchParams.get('q') ?? ''
  const q = qRaw.trim()
  if (q && q.length > 100) {
    res.status(422).json({ error: 'Invalid query' })
    return
  }

  const sellerIdRaw = url.searchParams.get('sellerId')
  let sellerId: number | undefined = undefined
  if (sellerIdRaw !== null) {
    const parsed = parseInt(sellerIdRaw, 10)
    if (Number.isNaN(parsed) || parsed < 1) {
      res.status(422).json({ error: 'Invalid sellerId' })
      return
    }
    sellerId = parsed
  }

  const skip = (page - 1) * size

  // Build where only if any filter is present; when no filters are given we
  // keep the original calls (no where) so existing behaviour and tests stay
  // unchanged.
  const where: any = {}
  if (sellerId !== undefined) where.sellerId = sellerId
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { description: { contains: q } },
    ]
  }

  const hasFilters = Object.keys(where).length > 0

  const [total, items] = await Promise.all([
    hasFilters ? prisma.product.count({ where }) : prisma.product.count(),
    prisma.product.findMany(Object.assign(
      hasFilters ? { where } : {},
      {
        skip,
        take: size,
        orderBy: { createdAt: 'desc' },
        include: { seller: { select: { id: true, name: true } } },
      }
    )),
  ])

  res.status(200).json({ items, total, page, size })
}
