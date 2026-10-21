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
import { idParam, parseOr400, pathSegment, productUpdateBody, requestUrl } from '../../../lib/validation'

export default apiRoute(async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Expect URLs like /api/products/1
  const id = parseOr400(res, idParam, pathSegment(requestUrl(req)))
  if (id === undefined) return

  if (req.method === 'PATCH' || req.method === 'DELETE') {
    await changeProduct(req, res, id)
    return
  }
  await getProduct(res, id)
}, { methods: ['GET', 'PATCH', 'DELETE'], name: '/api/products/[id]' })

async function getProduct(res: NextApiResponse, id: number) {
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

// Only the seller who owns the product may edit or delist it. The order of the
// checks is deliberate: who is asking (401), is the body sane (400), does the
// product exist (404), is it theirs (403) — and only then write.
async function changeProduct(req: NextApiRequest, res: NextApiResponse, id: number) {
  const seller = await authenticateSeller(prisma, req)
  if (!seller) {
    res.status(401).json(UNAUTHENTICATED)
    return
  }

  const changes = req.method === 'PATCH' ? parseOr400(res, productUpdateBody, readBody(req)) : undefined
  if (req.method === 'PATCH' && !changes) return

  const existing = await prisma.product.findUnique({ where: { id }, select: { id: true, sellerId: true } })
  if (!existing) {
    res.status(404).json({ error: 'Product not found' })
    return
  }
  if (existing.sellerId !== seller.id) {
    res.status(403).json(FORBIDDEN)
    return
  }

  if (req.method === 'DELETE') {
    // OrderItem rows keep their own snapshot and no foreign key to Product
    // (prisma/schema.prisma), so delisting never rewrites order history.
    await prisma.product.delete({ where: { id } })
    res.status(204).end()
    return
  }

  const product = await prisma.product.update({
    where: { id },
    data: changes!,
    include: { seller: { select: { id: true, name: true } } },
  })
  res.status(200).json(product)
}
