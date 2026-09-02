import { NextApiRequest, NextApiResponse } from 'next'
import { PrismaClient } from '@prisma/client'
import { reqUrl, parseIdFromPath, parsePageSize, skipFor } from '../../../lib/api-helpers'

const prisma = new PrismaClient()

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Expect URLs like /api/sellers/1
  const url = reqUrl(req)

  const parsed = parseIdFromPath(url)
  if (!parsed.ok) {
    res.status(422).json({ error: parsed.error })
    return
  }
  const { id } = parsed

  // Only support GET for now
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const paging = parsePageSize(url)
  if (!paging.ok) {
    res.status(422).json({ error: paging.error })
    return
  }
  const { page, size } = paging

  const skip = skipFor(page, size)

  // Ensure seller exists
  const seller = await prisma.seller.findUnique({ where: { id } })
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
