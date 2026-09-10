import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'

import { formatPrice } from '../../../lib/format'
import { describeStatus } from '../../../lib/orders'
import {
  buildSellerHref,
  pageCount,
  parseProductsQuery,
  type RouterQueryLike,
} from '../../../lib/products-query'

// The shape GET /api/sellers/[id]/orders returns: the seller as { id, name }
// (never an email), plus one page of that seller's own orders — status,
// when it was placed, this seller's lines only, and their subtotal. The
// order reference is never sent: this page is public and indexed by seller
// id, unlike the buyer confirmation page a reference is handed to once.
type Seller = { id: number; name: string }

type Line = { title: string; price_cents: number; quantity: number; line_total: number }

type SellerOrder = { status: string; createdAt: string | null; lines: Line[]; subtotal: number }

type SellerOrdersResponse = {
  seller: Seller
  orders: SellerOrder[]
  total: number
  page: number
  size: number
}

// The same four states pages/sellers/[id].tsx uses.
type Status = 'loading' | 'missing' | 'error' | 'ready'

export default function SellerOrdersPage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('loading')
  const [seller, setSeller] = useState<Seller | null>(null)
  const [orders, setOrders] = useState<SellerOrder[]>([])
  const [total, setTotal] = useState(0)

  const query = useMemo(
    () => parseProductsQuery(router.query as RouterQueryLike),
    [router.query]
  )

  const rawId = router.query.id
  const id = Array.isArray(rawId) ? rawId[0] : rawId
  const numericId = parseInt(String(id ?? ''), 10)
  const validId = Number.isFinite(numericId) && numericId >= 1

  useEffect(() => {
    if (!router.isReady) return

    if (!validId) {
      setSeller(null)
      setOrders([])
      setTotal(0)
      setStatus('missing')
      return
    }

    let cancelled = false
    setStatus('loading')

    fetch(`/api/sellers/${numericId}/orders?page=${query.page}&size=${query.size}`)
      .then((res) => {
        if (res.status === 404 || res.status === 422) return null
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<SellerOrdersResponse>
      })
      .then((data) => {
        if (cancelled) return
        if (!data || !data.seller || typeof data.seller.id !== 'number') {
          setSeller(null)
          setOrders([])
          setTotal(0)
          setStatus('missing')
          return
        }
        setSeller(data.seller)
        setOrders(Array.isArray(data.orders) ? data.orders : [])
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
  }, [router.isReady, numericId, validId, query.page, query.size])

  const pages = pageCount(total, query.size)

  return (
    <main style={{ font: '15px system-ui, sans-serif', maxWidth: 720, margin: '0 auto', padding: '32px 16px' }}>
      {validId && (
        <p style={{ fontSize: 13, marginTop: 0 }}>
          <Link href={buildSellerHref(numericId)} style={{ color: '#7c5cff' }}>
            &larr; Back to seller
          </Link>
        </p>
      )}

      {status === 'loading' && (
        <p role="status" style={{ color: '#9ca3af' }}>
          Loading orders&hellip;
        </p>
      )}

      {status === 'missing' && (
        <>
          <h1 style={{ fontSize: 24, marginBottom: 4 }}>Seller not found</h1>
          <p style={{ color: '#6b7280', marginTop: 0 }}>
            That seller does not exist, or they no longer sell here.
          </p>
        </>
      )}

      {status === 'error' && (
        <p role="alert" style={{ color: '#b91c1c' }}>
          Could not load these orders. Is the API running and the database seeded?
        </p>
      )}

      {status === 'ready' && seller && (
        <>
          <h1 style={{ fontSize: 24, marginBottom: 4 }}>{seller.name} &mdash; orders</h1>
          <p style={{ color: '#6b7280', marginTop: 0, fontSize: 13 }}>
            {total === 0
              ? 'No orders yet.'
              : `${total} order${total === 1 ? '' : 's'} touching this seller's products.`}
          </p>

          {orders.length > 0 && (
            <>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {orders.map((order, index) => (
                  <li key={index} style={{ borderTop: '1px solid #e5e7eb', padding: '12px 0' }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', justifyContent: 'space-between' }}>
                      <strong>{describeStatus(order.status)}</strong>
                      <span style={{ color: '#6b7280', fontSize: 13 }}>
                        {order.createdAt ? new Date(order.createdAt).toLocaleDateString() : ''}
                      </span>
                    </div>
                    <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0' }}>
                      {order.lines.map((line, lineIndex) => (
                        <li key={lineIndex} style={{ display: 'flex', gap: 12, fontSize: 13, color: '#374151' }}>
                          <span style={{ flex: 1 }}>
                            {line.title} &times; {line.quantity}
                          </span>
                          <span>{formatPrice(line.line_total)}</span>
                        </li>
                      ))}
                    </ul>
                    <div style={{ textAlign: 'right', fontSize: 13, marginTop: 4 }}>
                      Subtotal: {formatPrice(order.subtotal)}
                    </div>
                  </li>
                ))}
              </ul>

              <nav
                aria-label="Pagination"
                style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginTop: 16, fontSize: 13 }}
              >
                {query.page > 1 ? (
                  <Link
                    href={`/sellers/${seller.id}/orders?page=${query.page - 1}&size=${query.size}`}
                    style={{ color: '#7c5cff' }}
                  >
                    &larr; Prev
                  </Link>
                ) : (
                  <span style={{ color: '#d1d5db' }}>&larr; Prev</span>
                )}

                <span style={{ color: '#6b7280' }}>
                  Page {query.page} of {pages}
                </span>

                {query.page < pages ? (
                  <Link
                    href={`/sellers/${seller.id}/orders?page=${query.page + 1}&size=${query.size}`}
                    style={{ color: '#7c5cff' }}
                  >
                    Next &rarr;
                  </Link>
                ) : (
                  <span style={{ color: '#d1d5db' }}>Next &rarr;</span>
                )}
              </nav>
            </>
          )}
        </>
      )}
    </main>
  )
}
