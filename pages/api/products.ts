import { NextApiRequest, NextApiResponse } from 'next'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

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

  const skip = (page - 1) * size
  const [total, items] = await Promise.all([
    prisma.product.count(),
    prisma.product.findMany({
      skip,
      take: size,
      orderBy: { createdAt: 'desc' },
      include: { seller: { select: { id: true, name: true } } },
    }),
  ])

  res.status(200).json({ items, total, page, size })
}
