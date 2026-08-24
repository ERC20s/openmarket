import { NextApiRequest, NextApiResponse } from 'next'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
  const pageRaw = url.searchParams.get('page') ?? '1'
  const sizeRaw = url.searchParams.get('size') ?? '20'

  const q = url.searchParams.get('q') ?? ''
  const sellerIdRaw = url.searchParams.get('sellerId') ?? ''
  const minPriceRaw = url.searchParams.get('min_price_cents') ?? ''
  const maxPriceRaw = url.searchParams.get('max_price_cents') ?? ''

  const page = parseInt(pageRaw, 10)
  const size = parseInt(sizeRaw, 10)
  const sellerId = sellerIdRaw ? parseInt(sellerIdRaw, 10) : undefined
  const min_price_cents = minPriceRaw ? parseInt(minPriceRaw, 10) : undefined
  const max_price_cents = maxPriceRaw ? parseInt(maxPriceRaw, 10) : undefined

  if (Number.isNaN(page) || page < 1 || Number.isNaN(size) || size < 1 || size > 100) {
    res.status(422).json({ error: 'Invalid page or size' })
    return
  }

  if ((sellerIdRaw && Number.isNaN(sellerId)) || (minPriceRaw && Number.isNaN(min_price_cents)) || (maxPriceRaw && Number.isNaN(max_price_cents))) {
    res.status(422).json({ error: 'Invalid numeric filter' })
    return
  }

  const skip = (page - 1) * size

  // Build Prisma where object from optional filters
  const where: any = {}

  if (q) {
    // match title OR description containing the query substring
    where.OR = [
      { title: { contains: q } },
      { description: { contains: q } },
    ]
  }

  if (typeof sellerId === 'number') {
    where.sellerId = sellerId
  }

  if (typeof min_price_cents === 'number' || typeof max_price_cents === 'number') {
    where.price_cents = {}
    if (typeof min_price_cents === 'number') {
      where.price_cents.gte = min_price_cents
    }
    if (typeof max_price_cents === 'number') {
      where.price_cents.lte = max_price_cents
    }
    // if price_cents ended up empty (shouldn't), delete it
    if (Object.keys(where.price_cents).length === 0) delete where.price_cents
  }

  const [total, items] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      skip,
      take: size,
      orderBy: { createdAt: 'desc' },
      include: { seller: { select: { id: true, name: true } } },
    }),
  ])

  res.status(200).json({ items, total, page, size })
}
