import { NextApiRequest, NextApiResponse } from 'next'
import { PrismaClient } from '@prisma/client'

import { readBody } from '../../lib/quote'

declare global {
  // Allow a single PrismaClient instance to be shared across module reloads in dev
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

const prisma = (process.env.NODE_ENV === 'production')
  ? new PrismaClient()
  : (globalThis as any).__prisma ?? ((globalThis as any).__prisma = new PrismaClient())

import { apiRoute } from '../../lib/api'
import { UNAUTHENTICATED, authenticateSeller } from '../../lib/auth'
import { parseOr400, productCreateBody, productsQuery, queryOf, requestUrl } from '../../lib/validation'

export default apiRoute(async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    await createProduct(req, res)
    return
  }
  await listProducts(req, res)
}, { methods: ['GET', 'POST'], name: '/api/products' })

async function listProducts(req: NextApiRequest, res: NextApiResponse) {
  const query = parseOr400(res, productsQuery, queryOf(requestUrl(req), ['page', 'size', 'q', 'sellerId']))
  if (!query) return

  const { page, size, q, sellerId } = query
  const skip = (page - 1) * size

  // Build where only if any filter is present; when no filters are given we
  // keep the original calls (no where) so existing behaviour and tests stay
  // unchanged.
  const where: any = {}
  if (sellerId !== undefined) where.sellerId = sellerId
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { description: { contains: q } },
    ]
  }

  const hasFilters = Object.keys(where).length > 0

  const [total, items] = await Promise.all([
    hasFilters ? prisma.product.count({ where }) : prisma.product.count(),
    prisma.product.findMany(Object.assign(
      hasFilters ? { where } : {},
      {
        skip,
        take: size,
        orderBy: { createdAt: 'desc' },
        include: { seller: { select: { id: true, name: true } } },
      }
    )),
  ])

  res.status(200).json({ items, total, page, size })
}

// A seller lists a new product under their own storefront. The seller comes
// from the bearer token, never from the body: a body naming a sellerId is
// refused by the strict schema rather than trusted or silently dropped.
async function createProduct(req: NextApiRequest, res: NextApiResponse) {
  const seller = await authenticateSeller(prisma, req)
  if (!seller) {
    res.status(401).json(UNAUTHENTICATED)
    return
  }

  const body = parseOr400(res, productCreateBody, readBody(req))
  if (!body) return

  const product = await prisma.product.create({
    data: { ...body, sellerId: seller.id },
    include: { seller: { select: { id: true, name: true } } },
  })
  res.status(201).json(product)
}
