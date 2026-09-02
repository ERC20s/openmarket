import type { GetServerSideProps } from 'next'
import Head from 'next/head'
import Link from 'next/link'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const DEFAULT_PAGE = 1
const DEFAULT_SIZE = 20
const MAX_SIZE = 100

type Row = {
  id: number
  title: string
  description: string
  price_cents: number
  sellerId: number
  sellerName: string
}

type Props = {
  items: Row[]
  total: number
  page: number
  size: number
}

// Same bounds as GET /api/products: page >= 1, 1 <= size <= 100.
// A value outside those bounds falls back to the default instead of a 422,
// because a browser URL should still render a page.
function readInt(raw: string | string[] | undefined, fallback: number, min: number, max: number) {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value === undefined) return fallback
  const parsed = parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < min || parsed > max) return fallback
  return parsed
}

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const page = readInt(ctx.query.page, DEFAULT_PAGE, 1, Number.MAX_SAFE_INTEGER)
  const size = readInt(ctx.query.size, DEFAULT_SIZE, 1, MAX_SIZE)
  const skip = (page - 1) * size

  const [total, products] = await Promise.all([
    prisma.product.count(),
    prisma.product.findMany({
      skip,
      take: size,
      orderBy: { createdAt: 'desc' },
      include: { seller: { select: { id: true, name: true } } },
    }),
  ])

  // createdAt is a Date and is not serialisable as a page prop, so the rows
  // are flattened to plain JSON here.
  const items: Row[] = products.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    price_cents: p.price_cents,
    sellerId: p.seller.id,
    sellerName: p.seller.name,
  }))

  return { props: { items, total, page, size } }
}

export default function Storefront({ items, total, page, size }: Props) {
  const lastPage = Math.max(1, Math.ceil(total / size))
  const hasPrev = page > 1
  const hasNext = page < lastPage

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '2rem 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <Head>
        <title>openmarket</title>
      </Head>

      <h1>openmarket</h1>
      <p>A multi-seller marketplace. {total} product{total === 1 ? '' : 's'} listed.</p>

      {items.length === 0 ? (
        <p>
          No products yet. Seed the database with <code>npm run prisma:seed</code>.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {items.map((item) => (
            <li key={item.id} style={{ borderTop: '1px solid #ddd', padding: '0.75rem 0' }}>
              <strong>{item.title}</strong> — {money(item.price_cents)}
              <div style={{ color: '#555' }}>{item.description}</div>
              <div style={{ fontSize: '0.9rem' }}>
                Sold by <Link href={`/api/sellers/${item.sellerId}`}>{item.sellerName}</Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      <nav style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
        {hasPrev ? <Link href={`/?page=${page - 1}&size=${size}`}>← Previous</Link> : <span style={{ color: '#999' }}>← Previous</span>}
        <span>
          Page {page} of {lastPage}
        </span>
        {hasNext ? <Link href={`/?page=${page + 1}&size=${size}`}>Next →</Link> : <span style={{ color: '#999' }}>Next →</span>}
      </nav>
    </main>
  )
}
