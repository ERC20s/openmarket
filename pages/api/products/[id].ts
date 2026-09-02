import { NextApiRequest, NextApiResponse } from 'next'
import { PrismaClient } from '@prisma/client'
import { reqUrl, parseIdFromPath } from '../../../lib/api-helpers'

const prisma = new PrismaClient()

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Expect URLs like /api/products/1
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

  const product = await prisma.product.findUnique({
    where: { id },
    include: { seller: { select: { id: true, name: true } } },
  })

  if (!product) {
    res.status(404).json({ error: 'Product not found' })
    return
  }

  res.status(200).json(product)
}
