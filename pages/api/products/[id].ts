import { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Expect URLs like /api/products/1
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

  try {
    const product = await prisma.product.findUnique({
      where: { id },
      include: { seller: { select: { id: true, name: true } } },
    })

    if (!product) {
      res.status(404).json({ error: 'Product not found' })
      return
    }

    res.status(200).json(product)
  } catch (err) {
    console.error('GET /api/products/[id] failed', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
