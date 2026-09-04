import { useEffect, useState } from 'react'
import Link from 'next/link'

import { formatPrice } from '../lib/format'
import {
  CART_CHANGED_EVENT,
  CART_STORAGE_KEY,
  MAX_QUANTITY,
  MIN_QUANTITY,
  cartCount,
  cartSubtotal,
  clearCart,
  groupBySeller,
  readStoredCart,
  removeLine,
  setQuantity,
  writeStoredCart,
  type CartLine,
} from '../lib/cart'
import { buildProductHref, buildSellerHref } from '../lib/products-query'

// The cart lives in localStorage, which does not exist on the server. Reading
// it during render would make the first client render differ from the markup
// Next.js sent, so nothing is read until the effect below runs and `ready`
// flips — until then the page shows its loading line, exactly as the storefront
// does while /api/products is in flight.
export default function CartPage() {
  const [ready, setReady] = useState(false)
  const [lines, setLines] = useState<CartLine[]>([])

  useEffect(() => {
    setLines(readStoredCart())
    setReady(true)

    // Another tab (the storage event) or another page of this app (our own
    // event) changed the cart: pick it up rather than showing a stale total.
    function refresh() {
      setLines(readStoredCart())
    }
    function onStorage(event: StorageEvent) {
      if (event.key === null || event.key === CART_STORAGE_KEY) refresh()
    }

    window.addEventListener(CART_CHANGED_EVENT, refresh)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(CART_CHANGED_EVENT, refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  // One place that writes: state and storage never disagree.
  function commit(next: CartLine[]) {
    setLines(next)
    writeStoredCart(next)
  }

  const groups = groupBySeller(lines)
  const count = cartCount(lines)
  const total = cartSubtotal(lines)

  return (
    <main style={{ font: '15px system-ui, sans-serif', maxWidth: 720, margin: '0 auto', padding: '32px 16px' }}>
      <p style={{ fontSize: 13, marginTop: 0 }}>
        <Link href="/" style={{ color: '#7c5cff' }}>
          &larr; Back to the storefront
        </Link>
      </p>

      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Your cart</h1>

      {!ready && (
        <p role="status" style={{ color: '#9ca3af' }}>
          Loading your cart&hellip;
        </p>
      )}

      {ready && lines.length === 0 && (
        <p style={{ color: '#6b7280' }}>
          Your cart is empty.{' '}
          <Link href="/" style={{ color: '#7c5cff' }}>
            Browse the storefront
          </Link>{' '}
          and use Add to cart on any product.
        </p>
      )}

      {ready && lines.length > 0 && (
        <>
          <p style={{ color: '#6b7280', fontSize: 13 }}>
            {count} item{count === 1 ? '' : 's'} from {groups.length} seller
            {groups.length === 1 ? '' : 's'}. Saved in this browser only.
          </p>

          {/* One section per seller: this is a multi-seller marketplace, so who
              a line is bought from matters before the grand total does. */}
          {groups.map((group) => (
            <section key={group.sellerId} style={{ marginTop: 24 }}>
              <h2 style={{ fontSize: 15, margin: '0 0 4px' }}>
                {group.sellerId > 0 ? (
                  <Link href={buildSellerHref(group.sellerId)} style={{ color: '#7c5cff' }}>
                    {group.sellerName}
                  </Link>
                ) : (
                  group.sellerName
                )}
              </h2>

              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {group.lines.map((line) => (
                  <li
                    key={line.productId}
                    style={{ borderTop: '1px solid #e5e7eb', padding: '12px 0' }}
                  >
                    <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                      <strong style={{ flex: 1 }}>
                        <Link
                          href={buildProductHref(line.productId)}
                          style={{ color: 'inherit', textDecoration: 'none' }}
                        >
                          {line.title}
                        </Link>
                      </strong>
                      <span>{formatPrice(line.price_cents * line.quantity)}</span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        gap: 12,
                        alignItems: 'center',
                        marginTop: 6,
                        fontSize: 13,
                        color: '#6b7280',
                      }}
                    >
                      <span>{formatPrice(line.price_cents)} each</span>

                      <label htmlFor={`qty-${line.productId}`} style={{ marginLeft: 'auto' }}>
                        Qty
                      </label>
                      <input
                        id={`qty-${line.productId}`}
                        type="number"
                        inputMode="numeric"
                        min={MIN_QUANTITY}
                        max={MAX_QUANTITY}
                        value={line.quantity}
                        aria-label={`Quantity for ${line.title}`}
                        onChange={(event) =>
                          commit(setQuantity(lines, line.productId, event.target.value))
                        }
                        style={{
                          font: 'inherit',
                          width: 64,
                          padding: '4px 6px',
                          border: '1px solid #d1d5db',
                          borderRadius: 8,
                        }}
                      />

                      <button
                        type="button"
                        onClick={() => commit(removeLine(lines, line.productId))}
                        style={{
                          font: 'inherit',
                          color: '#b91c1c',
                          background: 'none',
                          border: 0,
                          padding: 0,
                          cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              <p style={{ fontSize: 13, color: '#6b7280', margin: '8px 0 0', textAlign: 'right' }}>
                Subtotal for {group.sellerName}: {formatPrice(group.subtotal)}
              </p>
            </section>
          ))}

          <p
            style={{
              borderTop: '2px solid #e5e7eb',
              marginTop: 24,
              paddingTop: 12,
              fontSize: 18,
              display: 'flex',
              gap: 12,
            }}
          >
            <span style={{ flex: 1 }}>Total</span>
            <strong>{formatPrice(total)}</strong>
          </p>

          {/* Prices here are the snapshot taken when each product was added;
              /checkout posts the cart to POST /api/checkout, which re-prices
              every line from the database and names anything that moved. */}
          <p style={{ marginTop: 16 }}>
            <Link
              href="/checkout"
              style={{
                display: 'inline-block',
                background: '#7c5cff',
                color: '#fff',
                borderRadius: 999,
                padding: '8px 18px',
                textDecoration: 'none',
              }}
            >
              Review and check out
            </Link>
          </p>

          <p style={{ fontSize: 13, color: '#6b7280' }}>
            Prices above are what they were when each product was added; checkout
            confirms them against the marketplace.{' '}
            <button
              type="button"
              onClick={() => commit(clearCart())}
              style={{
                font: 'inherit',
                color: '#7c5cff',
                background: 'none',
                border: 0,
                padding: 0,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Empty the cart
            </button>
          </p>
        </>
      )}
    </main>
  )
}
