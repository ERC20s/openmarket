import { NextApiRequest, NextApiResponse } from 'next'
import { PrismaClient } from '@prisma/client'

declare global {
  // eslint-disable-next-line no-var
  var __prisma?: PrismaClient
}

const prisma = (process.env.NODE_ENV === 'production')
  ? new PrismaClient()
  : (globalThis as any).__prisma ?? ((globalThis as any).__prisma = new PrismaClient())

import { apiRoute } from '../../../lib/api'

export default apiRoute(async function handler(req: NextApiRequest, res: NextApiResponse) {
  await getSeller(req, res)
}, { methods: ['GET'], name: 'GET /api/sellers/[id]' })

async function getSeller(req: NextApiRequest, res: NextApiResponse) {
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

  const pageRaw = url.searchParams.get('page')
  const sizeRaw = url.searchParams.get('size')

  const { page, size, skip, error } = require('../../../lib/pagination').parsePageSize(pageRaw, sizeRaw)
  if (error) {
    res.status(422).json({ error })
    return
  }

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
