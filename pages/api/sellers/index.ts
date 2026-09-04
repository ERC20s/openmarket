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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only support GET for now — the same guard /api/products and the /[id]
  // routes carry, so a POST answers 405 JSON instead of running the query.
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    await listSellers(req, res)
  } catch (err) {
    // Details stay in the server log; the client gets a stable JSON shape
    // instead of Next's HTML error page or a stack trace.
    console.error('GET /api/sellers failed', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

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
