import { NextApiRequest, NextApiResponse } from 'next'
import { PrismaClient } from '@prisma/client'

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

const prisma = (process.env.NODE_ENV === 'production')
  ? new PrismaClient()
  : (globalThis as any).__prisma ?? ((globalThis as any).__prisma = new PrismaClient())

import { apiRoute } from '../../../lib/api'
import { FORBIDDEN, UNAUTHENTICATED, authenticateSeller } from '../../../lib/auth'
import { readBody } from '../../../lib/quote'
import {
  idParam,
  paginationQuery,
  parseOr400,
  pathSegment,
  queryOf,
  requestUrl,
  storefrontUpdateBody,
} from '../../../lib/validation'

export default apiRoute(async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'PATCH') {
    await updateStorefront(req, res)
    return
  }
  await getSeller(req, res)
}, { methods: ['GET', 'PATCH'], name: '/api/sellers/[id]' })

async function getSeller(req: NextApiRequest, res: NextApiResponse) {
  // Expect URLs like /api/sellers/1
  const url = requestUrl(req)
  const id = parseOr400(res, idParam, pathSegment(url))
  if (id === undefined) return

  const query = parseOr400(res, paginationQuery, queryOf(url, ['page', 'size']))
  if (!query) return
  const { page, size } = query
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

// A seller edits their own storefront (today: its display name) and nobody
// else's. The token says who is asking; the path says whose storefront.
async function updateStorefront(req: NextApiRequest, res: NextApiResponse) {
  const id = parseOr400(res, idParam, pathSegment(requestUrl(req)))
  if (id === undefined) return

  const seller = await authenticateSeller(prisma, req)
  if (!seller) {
    res.status(401).json(UNAUTHENTICATED)
    return
  }
  if (seller.id !== id) {
    res.status(403).json(FORBIDDEN)
    return
  }

  const changes = parseOr400(res, storefrontUpdateBody, readBody(req))
  if (!changes) return

  const updated = await prisma.seller.update({
    where: { id },
    data: changes,
    select: { id: true, name: true },
  })
  res.status(200).json({ seller: updated })
}
