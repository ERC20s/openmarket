import { NextApiRequest, NextApiResponse } from 'next'
import { PrismaClient } from '@prisma/client'
import { reqUrl, parsePageSize, skipFor } from '../../lib/api-helpers'

const prisma = new PrismaClient()

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const url = reqUrl(req)

  const paging = parsePageSize(url)
  if (!paging.ok) {
    res.status(422).json({ error: paging.error })
    return
  }
  const { page, size } = paging

  const skip = skipFor(page, size)
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
