import { useEffect, useState } from 'react'
import Link from 'next/link'

import { formatPrice } from '../lib/format'
import { cartCount, readStoredCart, type CartLine } from '../lib/cart'
import { buildProductHref, buildSellerHref } from '../lib/products-query'

// The review step. Everything money-related on this page comes back from
// POST /api/checkout — the localStorage cart is only the *request*. That is the
// whole point of the round trip: a line added last week is priced at today's
// database price, and anything that changed is listed as a problem before the
// buyer is asked to confirm.
//
// As on /cart, storage is read inside an effect so the first client render
// matches the server markup.

type QuoteLine = {
  productId: number
  title: string
  price_cents: number
  quantity: number
  line_total: number
  sellerId: number
  sellerName: string
}

type QuoteSeller = {
  sellerId: number
  sellerName: string
  lines: QuoteLine[]
  subtotal: number
}

type QuoteProblem = {
  code: string
  productId: number
  was?: number
  now?: number
  message: string
}

type Quote = {
  lines: QuoteLine[]
  sellers: QuoteSeller[]
  total: number
  count: number
  problems: QuoteProblem[]
}

type State =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ready'; quote: Quote; cartTotal: number }

export default function CheckoutPage() {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function quote() {
      const lines: CartLine[] = readStoredCart()
      if (lines.length === 0) {
        if (!cancelled) setState({ status: 'empty' })
        return
      }

      // The claimed price goes with each line so the server can tell the buyer
      // which ones moved; the server ignores it when pricing.
      const payload = {
        lines: lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          price_cents: line.price_cents,
        })),
      }
      const cartTotal = lines.reduce((sum, line) => sum + line.price_cents * line.quantity, 0)

      try {
        const response = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await response.json().catch(() => null)

        if (cancelled) return

        if (!response.ok) {
          setState({
            status: 'error',
            message: (data && data.error) || `Checkout failed (HTTP ${response.status}).`,
          })
          return
        }
        if (!data || !Array.isArray(data.lines)) {
          setState({ status: 'error', message: 'Checkout returned an unexpected answer.' })
          return
        }

        setState({
          status: 'ready',
          quote: {
            lines: data.lines,
            sellers: Array.isArray(data.sellers) ? data.sellers : [],
            total: typeof data.total === 'number' ? data.total : 0,
            count: typeof data.count === 'number' ? data.count : cartCount(lines),
            problems: Array.isArray(data.problems) ? data.problems : [],
          },
          cartTotal,
        })
      } catch {
        if (!cancelled) {
          setState({ status: 'error', message: 'Could not reach the checkout. Is the server running?' })
        }
      }
    }

    quote()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main style={{ font: '15px system-ui, sans-serif', maxWidth: 720, margin: '0 auto', padding: '32px 16px' }}>
      <p style={{ fontSize: 13, marginTop: 0 }}>
        <Link href="/cart" style={{ color: '#7c5cff' }}>
          &larr; Back to the cart
        </Link>
      </p>

      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Review your order</h1>

      {state.status === 'loading' && (
        <p role="status" style={{ color: '#9ca3af' }}>
          Checking today&rsquo;s prices&hellip;
        </p>
      )}

      {state.status === 'empty' && (
        <p style={{ color: '#6b7280' }}>
          Your cart is empty.{' '}
          <Link href="/" style={{ color: '#7c5cff' }}>
            Browse the storefront
          </Link>{' '}
          and use Add to cart on any product.
        </p>
      )}

      {state.status === 'error' && (
        <p role="alert" style={{ color: '#b91c1c' }}>
          {state.message}
        </p>
      )}

      {state.status === 'ready' && (
        <>
          <p style={{ color: '#6b7280', fontSize: 13 }}>
            {state.quote.count} item{state.quote.count === 1 ? '' : 's'} from{' '}
            {state.quote.sellers.length} seller{state.quote.sellers.length === 1 ? '' : 's'}, priced
            from the marketplace just now.
          </p>

          {state.quote.problems.length > 0 && (
            <section
              role="alert"
              style={{
                border: '1px solid #fca5a5',
                background: '#fef2f2',
                borderRadius: 8,
                padding: '12px 16px',
                margin: '16px 0',
              }}
            >
              <strong style={{ fontSize: 14 }}>Some lines changed since you added them</strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, color: '#7f1d1d' }}>
                {state.quote.problems.map((problem, index) => (
                  <li key={`${problem.code}-${problem.productId}-${index}`} style={{ marginBottom: 4 }}>
                    {problem.message}
                    {problem.code === 'price_changed' &&
                      typeof problem.was === 'number' &&
                      typeof problem.now === 'number' && (
                        <>
                          {' '}
                          ({formatPrice(problem.was)} &rarr; {formatPrice(problem.now)})
                        </>
                      )}
                  </li>
                ))}
              </ul>
              <p style={{ margin: '8px 0 0', fontSize: 13, color: '#7f1d1d' }}>
                The total below already uses the marketplace&rsquo;s current prices.
              </p>
            </section>
          )}

          {state.quote.lines.length === 0 && (
            <p style={{ color: '#6b7280' }}>
              Nothing in your cart is still for sale.{' '}
              <Link href="/cart" style={{ color: '#7c5cff' }}>
                Go back to the cart
              </Link>{' '}
              and empty it.
            </p>
          )}

          {state.quote.sellers.map((group) => (
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
                  <li key={line.productId} style={{ borderTop: '1px solid #e5e7eb', padding: '12px 0' }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                      <strong style={{ flex: 1 }}>
                        <Link
                          href={buildProductHref(line.productId)}
                          style={{ color: 'inherit', textDecoration: 'none' }}
                        >
                          {line.title}
                        </Link>
                      </strong>
                      <span>{formatPrice(line.line_total)}</span>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 13, color: '#6b7280' }}>
                      {formatPrice(line.price_cents)} each &times; {line.quantity}
                    </div>
                  </li>
                ))}
              </ul>

              <p style={{ fontSize: 13, color: '#6b7280', margin: '8px 0 0', textAlign: 'right' }}>
                Subtotal for {group.sellerName}: {formatPrice(group.subtotal)}
              </p>
            </section>
          ))}

          {state.quote.lines.length > 0 && (
            <>
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
                <span style={{ flex: 1 }}>Total to pay</span>
                <strong>{formatPrice(state.quote.total)}</strong>
              </p>

              {state.cartTotal !== state.quote.total && (
                <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>
                  Your cart showed {formatPrice(state.cartTotal)}; the marketplace price is{' '}
                  {formatPrice(state.quote.total)}.
                </p>
              )}

              <p style={{ fontSize: 13, color: '#6b7280' }}>
                Nothing has been ordered or paid for yet: this page only prices the cart. Placing
                the order and paying for it are the next pieces of the marketplace.
              </p>
            </>
          )}
        </>
      )}
    </main>
  )
}
