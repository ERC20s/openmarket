import { NextApiRequest, NextApiResponse } from 'next'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Ids are positive integers only: "1", "42". Anything else ("9abc", "9.7",
// "9%20", "-1", "0", "01") is rejected instead of being coerced by parseInt.
const ID_PATTERN = /^[1-9][0-9]*$/

function readId(req: NextApiRequest): number | null {
  // Prefer the value Next.js resolves from the route segment; fall back to the
  // last path segment so directly-invoked (mocked) requests keep working.
  const fromQuery = req.query ? req.query.id : undefined
  let raw: string | undefined

  if (typeof fromQuery === 'string') {
    raw = fromQuery
  } else if (Array.isArray(fromQuery)) {
    raw = fromQuery[fromQuery.length - 1]
  } else {
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
    const parts = url.pathname.split('/')
    raw = parts[parts.length - 1]
  }

  if (typeof raw !== 'string' || !ID_PATTERN.test(raw)) {
    return null
  }

  const id = Number(raw)
  return Number.isSafeInteger(id) ? id : null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only support GET for now. Checked before the id so a POST to a malformed
  // id answers 405, matching the documented contract.
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // Expect URLs like /api/products/1
  const id = readId(req)
  if (id === null) {
    res.status(422).json({ error: 'Invalid id' })
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
