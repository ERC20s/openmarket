import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'

import { formatPrice } from '../../lib/format'
import { addLine, readStoredCart, writeStoredCart } from '../../lib/cart'
import {
  buildSellerHref,
  buildStorefrontHref,
  parseProductsQuery,
  type RouterQueryLike,
} from '../../lib/products-query'

// The shape GET /api/products/[id] returns: one row from prisma/schema.prisma
// with the seller included as { id, name } only (the email column is never sent).
type Seller = { id: number; name: string }

type Product = {
  id: number
  title: string
  description: string
  price_cents: number
  sellerId: number
  seller?: Seller | null
}

// Four distinct states, the same discipline as pages/index.tsx: a product that
// does not exist must never look like a broken server.
//   'missing' = the API's 404 'Product not found' or 422 'Invalid id'
type Status = 'loading' | 'missing' | 'error' | 'ready'

export default function ProductPage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('loading')
  const [product, setProduct] = useState<Product | null>(null)
  // What the Add to cart button says after a click: nothing yet, the saved
  // confirmation, or the line that admits storage refused the write.
  const [added, setAdded] = useState<'idle' | 'added' | 'failed'>('idle')

  // Everything after /products/<id> is the storefront state the visitor came
  // from (?q=…&sellerId=…&page=…&size=…), read back with the same parser the
  // storefront uses, so "Back to results" returns to that exact list.
  const query = useMemo(
    () => parseProductsQuery(router.query as RouterQueryLike),
    [router.query]
  )

  // router.query is empty before hydration, so the id is only known once
  // isReady is true; a repeated param arrives as an array — take the first.
  const rawId = router.query.id
  const id = Array.isArray(rawId) ? rawId[0] : rawId

  useEffect(() => {
    if (!router.isReady) return

    const numericId = parseInt(String(id ?? ''), 10)
    if (!Number.isFinite(numericId) || numericId < 1) {
      // The same judgement the API makes (422 'Invalid id'); no point in a
      // round trip for /products/abc.
      setProduct(null)
      setStatus('missing')
      return
    }

    let cancelled = false
    setStatus('loading')
    // A different product is being shown: the previous "Added" line must go.
    setAdded('idle')

    fetch(`/api/products/${numericId}`)
      .then((res) => {
        if (res.status === 404 || res.status === 422) return null
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<Product>
      })
      .then((data) => {
        if (cancelled) return
        if (!data || typeof data.id !== 'number') {
          setProduct(null)
          setStatus('missing')
          return
        }
        setProduct(data)
        setStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [router.isReady, id])

  // Back to the list the visitor came from, filters and page intact.
  const backHref = buildStorefrontHref(query)

  // Add to cart: read what is stored, merge this product in (a repeat click
  // bumps the quantity rather than adding a second row) and write it back. The
  // title, price and seller are snapshotted here, so /cart renders with the API
  // down; nothing throws, because lib/cart.ts swallows a full or disabled store
  // and reports it with `false` instead.
  function onAddToCart() {
    if (!product) return

    const next = addLine(readStoredCart(), {
      productId: product.id,
      title: product.title,
      price_cents: product.price_cents,
      sellerId: product.sellerId,
      sellerName: product.seller?.name ?? `Seller #${product.sellerId}`,
    })

    setAdded(writeStoredCart(next) ? 'added' : 'failed')
  }

  return (
    <main style={{ font: '15px system-ui, sans-serif', maxWidth: 720, margin: '0 auto', padding: '32px 16px' }}>
      <p style={{ fontSize: 13, marginTop: 0 }}>
        <Link href={backHref} style={{ color: '#7c5cff' }}>
          &larr; Back to results
        </Link>
      </p>

      {status === 'loading' && (
        <p role="status" style={{ color: '#9ca3af' }}>
          Loading product&hellip;
        </p>
      )}

      {status === 'missing' && (
        <>
          <h1 style={{ fontSize: 24, marginBottom: 4 }}>Product not found</h1>
          <p style={{ color: '#6b7280', marginTop: 0 }}>
            That product does not exist, or it is no longer listed.
          </p>
        </>
      )}

      {status === 'error' && (
        <p role="alert" style={{ color: '#b91c1c' }}>
          Could not load this product. Is the API running and the database seeded?
        </p>
      )}

      {status === 'ready' && product && (
        <article>
          <h1 style={{ fontSize: 24, marginBottom: 4 }}>{product.title}</h1>
          <p style={{ fontSize: 20, margin: '0 0 12px' }}>{formatPrice(product.price_cents)}</p>

          {product.description && (
            <p style={{ color: '#374151', whiteSpace: 'pre-line' }}>{product.description}</p>
          )}

          <p style={{ fontSize: 13, color: '#6b7280' }}>
            Sold by{' '}
            {/* The name opens the seller page — the same link the storefront
                row uses. */}
            <Link
              href={buildSellerHref(product.sellerId, { size: query.size })}
              style={{ color: '#7c5cff' }}
            >
              {product.seller?.name ?? `Seller #${product.sellerId}`}
            </Link>
          </p>

          {/* Add to cart writes through lib/cart.ts to localStorage; the
              checkout stub hangs off /cart next. */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 20 }}>
            <button
              type="button"
              onClick={onAddToCart}
              style={{
                font: 'inherit',
                padding: '8px 16px',
                border: 0,
                borderRadius: 999,
                background: '#7c5cff',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Add to cart
            </button>

            {added === 'added' && (
              <span role="status" style={{ fontSize: 13, color: '#059669' }}>
                Added.{' '}
                <Link href="/cart" style={{ color: '#7c5cff' }}>
                  View cart
                </Link>
              </span>
            )}

            {added === 'failed' && (
              <span role="alert" style={{ fontSize: 13, color: '#b91c1c' }}>
                Could not save your cart — storage is full or disabled in this browser.
              </span>
            )}
          </div>
        </article>
      )}
    </main>
  )
}
