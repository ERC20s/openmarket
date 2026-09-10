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

// The seller picker on the storefront needs every seller at once, and a select
// with more than a hundred options is unusable anyway: cap the list rather than
// page it, and revisit with search-as-you-type if a marketplace ever outgrows it.
export const MAX_SELLERS = 100

import { apiRoute } from '../../lib/api'

export default apiRoute(async function handler(req: NextApiRequest, res: NextApiResponse) {
  await listSellers(req, res)
}, { methods: ['GET'], name: 'GET /api/sellers' })

async function listSellers(_req: NextApiRequest, res: NextApiResponse) {
  // Select explicitly. A bare findMany returns every column, which would ship
  // every seller's email address to any visitor — the same leak the /[id]
  // route was fixed for. The public shape stays { id, name } plus the count.
  const rows = await prisma.seller.findMany({
    take: MAX_SELLERS,
    orderBy: { name: 'asc' },
    select: { id: true, name: true, _count: { select: { products: true } } },
  })

  const sellers = (Array.isArray(rows) ? rows : []).map((row: any) => ({
    id: row.id,
    name: row.name,
    productCount: row._count?.products ?? 0,
  }))

  res.status(200).json({ sellers, total: sellers.length })
}
