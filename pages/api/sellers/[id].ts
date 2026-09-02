import { NextApiRequest, NextApiResponse } from 'next'
import { PrismaClient } from '@prisma/client'

declare global {
  // eslint-disable-next-line no-var
  var __prisma?: PrismaClient
}

const prisma = (process.env.NODE_ENV === 'production')
  ? new PrismaClient()
  : (globalThis as any).__prisma ?? ((globalThis as any).__prisma = new PrismaClient())

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Expect URLs like /api/sellers/1
  const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
  const parts = url.pathname.split('/')
  const last = parts[parts.length - 1]
  const id = parseInt(last, 10)

  if (Number.isNaN(id) || id < 1) {
    res.status(422).json({ error: 'Invalid id' })
    return
  }

  // Only support GET for now
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const pageRaw = url.searchParams.get('page') ?? '1'
  const sizeRaw = url.searchParams.get('size') ?? '20'

  const page = parseInt(pageRaw, 10)
  const size = parseInt(sizeRaw, 10)

  if (Number.isNaN(page) || page < 1 || Number.isNaN(size) || size < 1 || size > 100) {
    res.status(422).json({ error: 'Invalid page or size' })
    return
  }

  const skip = (page - 1) * size

  // Ensure seller exists. Select explicitly: a bare findUnique returns every
  // column, which would ship the seller's email address to any visitor. The
  // public shape is the same one products embed: { id, name }.
  const seller = await prisma.seller.findUnique({
    where: { id },
    select: { id: true, name: true },
  })
  if (!seller) {
    res.status(404).json({ error: 'Seller not found' })
    return
  }

  const [total, products] = await Promise.all([
    prisma.product.count({ where: { sellerId: id } }),
    prisma.product.findMany({
      where: { sellerId: id },
      skip,
      take: size,
      orderBy: { createdAt: 'desc' },
      include: { seller: { select: { id: true, name: true } } },
    }),
  ])

  res.status(200).json({ seller, products, total, page, size })
}
