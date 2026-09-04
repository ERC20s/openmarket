import { useEffect, useState } from 'react'

import { formatPrice } from '../lib/format'

// The shape GET /api/products returns: rows from prisma/schema.prisma with the
// seller included as { id, name } only (the email column is never sent).
type Seller = { id: number; name: string }

type Product = {
  id: number
  title: string
  description: string
  price_cents: number
  sellerId: number
  seller?: Seller | null
}

type ProductsResponse = {
  items: Product[]
  total: number
  page: number
  size: number
}

// Four distinct states, so an empty shop never looks like a broken one:
// loading, error, loaded-but-empty, loaded-with-rows.
type Status = 'loading' | 'error' | 'ready'

export default function Home() {
  const [status, setStatus] = useState<Status>('loading')
  const [items, setItems] = useState<Product[]>([])
  const [total, setTotal] = useState(0)

  useEffect(() => {
    let cancelled = false

    fetch('/api/products?page=1&size=20')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<ProductsResponse>
      })
      .then((data) => {
        if (cancelled) return
        setItems(Array.isArray(data.items) ? data.items : [])
        setTotal(typeof data.total === 'number' ? data.total : 0)
        setStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main style={{ font: '15px system-ui, sans-serif', maxWidth: 720, margin: '0 auto', padding: '32px 16px' }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>openmarket</h1>
      <p style={{ color: '#6b7280', marginTop: 0 }}>A multi-seller marketplace.</p>

      {status === 'loading' && (
        <p role="status" style={{ color: '#9ca3af' }}>
          Loading products&hellip;
        </p>
      )}

      {status === 'error' && (
        <p role="alert" style={{ color: '#b91c1c' }}>
          Could not load products. Is the API running and the database seeded?
        </p>
      )}

      {status === 'ready' && items.length === 0 && (
        <p style={{ color: '#6b7280' }}>
          No products yet. Seed the database with npm run prisma:seed.
        </p>
      )}

      {status === 'ready' && items.length > 0 && (
        <>
          <p style={{ color: '#6b7280', fontSize: 13 }}>
            Showing {items.length} of {total} product{total === 1 ? '' : 's'}.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {items.map((product) => (
              <li key={product.id} style={{ borderTop: '1px solid #e5e7eb', padding: '12px 0' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                  <strong style={{ flex: 1 }}>{product.title}</strong>
                  <span>{formatPrice(product.price_cents)}</span>
                </div>
                {product.description && (
                  <div style={{ color: '#6b7280', fontSize: 13 }}>{product.description}</div>
                )}
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  {/* Seller pages are not built yet; link to the seller API route
                      the previous cycles hardened until one exists. */}
                  <a href={`/api/sellers/${product.sellerId}`} style={{ color: '#7c5cff' }}>
                    {product.seller?.name ?? `Seller #${product.sellerId}`}
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  )
}
