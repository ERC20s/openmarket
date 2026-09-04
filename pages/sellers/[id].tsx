import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'

import { formatPrice } from '../../lib/format'
import {
  buildProductHref,
  buildSellerHref,
  buildStorefrontHref,
  pageCount,
  parseProductsQuery,
  type RouterQueryLike,
} from '../../lib/products-query'

// The shape GET /api/sellers/[id] returns: the seller as { id, name } only (the
// email column is never sent) plus one page of that seller's products.
type Seller = { id: number; name: string }

type Product = {
  id: number
  title: string
  description: string
  price_cents: number
  sellerId: number
  seller?: Seller | null
}

type SellerResponse = {
  seller: Seller
  products: Product[]
  total: number
  page: number
  size: number
}

// The same four states pages/products/[id].tsx uses: a seller who does not
// exist must never look like a broken server.
//   'missing' = the API's 404 'Seller not found' or 422 'Invalid id'
type Status = 'loading' | 'missing' | 'error' | 'ready'

export default function SellerPage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('loading')
  const [seller, setSeller] = useState<Seller | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)

  // Only page and size are meaningful here; parseProductsQuery clamps them to
  // the same bounds the API answers 422 on, so /sellers/1?page=0 lands on
  // page 1 rather than the red error banner.
  const query = useMemo(
    () => parseProductsQuery(router.query as RouterQueryLike),
    [router.query]
  )

  // router.query is empty before hydration, so the id is only known once
  // isReady is true; a repeated param arrives as an array — take the first.
  const rawId = router.query.id
  const id = Array.isArray(rawId) ? rawId[0] : rawId
  const numericId = parseInt(String(id ?? ''), 10)
  const validId = Number.isFinite(numericId) && numericId >= 1

  useEffect(() => {
    if (!router.isReady) return

    if (!validId) {
      // The same judgement the API makes (422 'Invalid id'); no point in a
      // round trip for /sellers/abc.
      setSeller(null)
      setProducts([])
      setTotal(0)
      setStatus('missing')
      return
    }

    let cancelled = false
    setStatus('loading')

    fetch(`/api/sellers/${numericId}?page=${query.page}&size=${query.size}`)
      .then((res) => {
        if (res.status === 404 || res.status === 422) return null
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<SellerResponse>
      })
      .then((data) => {
        if (cancelled) return
        if (!data || !data.seller || typeof data.seller.id !== 'number') {
          setSeller(null)
          setProducts([])
          setTotal(0)
          setStatus('missing')
          return
        }
        setSeller(data.seller)
        setProducts(Array.isArray(data.products) ? data.products : [])
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
    // Primitives, not the object: a new router.query identity with the same
    // values must not fire a second request.
  }, [router.isReady, numericId, validId, query.page, query.size])

  const pages = pageCount(total, query.size)
  const firstRow = total === 0 ? 0 : (query.page - 1) * query.size + 1
  const lastRow = firstRow === 0 ? 0 : firstRow + products.length - 1

  // The storefront state a product row carries, so "Back to results" on the
  // detail page returns to this seller's list at the same page and size. The
  // seller-filtered storefront orders by createdAt desc exactly as this API
  // does, so the page number means the same thing on both.
  const rowQuery = validId
    ? { sellerId: numericId, page: query.page, size: query.size }
    : { page: query.page, size: query.size }

  return (
    <main style={{ font: '15px system-ui, sans-serif', maxWidth: 720, margin: '0 auto', padding: '32px 16px' }}>
      <p style={{ fontSize: 13, marginTop: 0 }}>
        <Link href={buildStorefrontHref({ size: query.size })} style={{ color: '#7c5cff' }}>
          &larr; All products
        </Link>
      </p>

      {status === 'loading' && (
        <p role="status" style={{ color: '#9ca3af' }}>
          Loading seller&hellip;
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
          Could not load this seller. Is the API running and the database seeded?
        </p>
      )}

      {status === 'ready' && seller && (
        <>
          <h1 style={{ fontSize: 24, marginBottom: 4 }}>{seller.name}</h1>
          <p style={{ color: '#6b7280', marginTop: 0, fontSize: 13 }}>
            {total === 0
              ? 'No products listed yet.'
              : `Showing ${firstRow}–${lastRow} of ${total} product${total === 1 ? '' : 's'}.`}
          </p>

          {products.length === 0 && query.page > 1 && (
            <p style={{ color: '#6b7280' }}>
              Nothing on page {query.page}.{' '}
              <Link href={buildSellerHref(seller.id, { size: query.size })} style={{ color: '#7c5cff' }}>
                Back to the first page
              </Link>
            </p>
          )}

          {products.length > 0 && (
            <>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {products.map((product) => (
                  <li key={product.id} style={{ borderTop: '1px solid #e5e7eb', padding: '12px 0' }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                      <strong style={{ flex: 1 }}>
                        <Link
                          href={buildProductHref(product.id, rowQuery)}
                          style={{ color: 'inherit', textDecoration: 'none' }}
                        >
                          {product.title}
                        </Link>
                      </strong>
                      <span>{formatPrice(product.price_cents)}</span>
                    </div>
                    {product.description && (
                      <div style={{ color: '#6b7280', fontSize: 13 }}>{product.description}</div>
                    )}
                  </li>
                ))}
              </ul>

              <nav
                aria-label="Pagination"
                style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginTop: 16, fontSize: 13 }}
              >
                {query.page > 1 ? (
                  <Link
                    href={buildSellerHref(seller.id, { page: query.page - 1, size: query.size })}
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
                    href={buildSellerHref(seller.id, { page: query.page + 1, size: query.size })}
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

          <p style={{ fontSize: 13, marginTop: 24 }}>
            <Link
              href={buildStorefrontHref({ sellerId: seller.id, size: query.size })}
              style={{ color: '#7c5cff' }}
            >
              Search within this seller
            </Link>
          </p>
        </>
      )}
    </main>
  )
}
