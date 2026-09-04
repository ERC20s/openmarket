import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'

import { formatPrice } from '../../lib/format'
import { buildProductHref, buildSellerHref } from '../../lib/products-query'
import { describeStatus, isOrderReference } from '../../lib/orders'

// The confirmation page. Everything on it comes back from
// GET /api/orders/<reference> — the order was priced and written on the server,
// so nothing here is read out of the browser's cart (which the Place order
// button emptied on the way in).
//
// The reference in the URL is an unguessable token, not a login: the API
// returns only what was bought, and the Order model holds no buyer detail.

type OrderLine = {
  productId: number
  title: string
  price_cents: number
  quantity: number
  line_total: number
  sellerId: number
  sellerName: string
}

type OrderSeller = {
  sellerId: number
  sellerName: string
  lines: OrderLine[]
  subtotal: number
}

type Order = {
  reference: string
  status: string
  total: number
  count: number
  createdAt: string | null
  lines: OrderLine[]
  sellers: OrderSeller[]
}

type State =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; order: Order }

export default function OrderPage() {
  const router = useRouter()
  const raw = router.query.id
  const reference = Array.isArray(raw) ? raw[0] : raw
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    // next/router fills the query in only after hydration.
    if (!router.isReady) return

    if (!isOrderReference(reference)) {
      setState({ status: 'missing' })
      return
    }

    let cancelled = false

    async function load() {
      try {
        const response = await fetch(`/api/orders/${encodeURIComponent(String(reference))}`)
        const data = await response.json().catch(() => null)
        if (cancelled) return

        // 404 and 422 are both "no such order", not the red banner.
        if (response.status === 404 || response.status === 422) {
          setState({ status: 'missing' })
          return
        }
        if (!response.ok) {
          setState({
            status: 'error',
            message: (data && data.error) || `Could not load this order (HTTP ${response.status}).`,
          })
          return
        }
        if (!data || !Array.isArray(data.lines)) {
          setState({ status: 'error', message: 'The order service returned an unexpected answer.' })
          return
        }

        setState({
          status: 'ready',
          order: {
            reference: String(data.reference ?? reference),
            status: typeof data.status === 'string' ? data.status : 'pending',
            total: typeof data.total === 'number' ? data.total : 0,
            count: typeof data.count === 'number' ? data.count : 0,
            createdAt: typeof data.createdAt === 'string' ? data.createdAt : null,
            lines: data.lines,
            sellers: Array.isArray(data.sellers) ? data.sellers : [],
          },
        })
      } catch {
        if (!cancelled) {
          setState({ status: 'error', message: 'Could not reach the order service. Is the server running?' })
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [router.isReady, reference])

  return (
    <main style={{ font: '15px system-ui, sans-serif', maxWidth: 720, margin: '0 auto', padding: '32px 16px' }}>
      <p style={{ fontSize: 13, marginTop: 0 }}>
        <Link href="/" style={{ color: '#7c5cff' }}>
          &larr; Back to the storefront
        </Link>
      </p>

      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Thank you — your order is placed</h1>

      {state.status === 'loading' && (
        <p role="status" style={{ color: '#9ca3af' }}>
          Loading your order&hellip;
        </p>
      )}

      {state.status === 'missing' && (
        <p style={{ color: '#6b7280' }}>
          Order not found. Check the link in full, or{' '}
          <Link href="/" style={{ color: '#7c5cff' }}>
            browse the storefront
          </Link>
          .
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
            Reference <strong style={{ color: '#111827' }}>{state.order.reference}</strong> &middot;{' '}
            {describeStatus(state.order.status)} &middot; {state.order.count} item
            {state.order.count === 1 ? '' : 's'} from {state.order.sellers.length} seller
            {state.order.sellers.length === 1 ? '' : 's'}
          </p>
          <p style={{ color: '#6b7280', fontSize: 13, marginTop: 0 }}>
            Keep this link: it is the only way back to this order.
          </p>

          {state.order.sellers.map((group) => (
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
            <span style={{ flex: 1 }}>Order total</span>
            <strong>{formatPrice(state.order.total)}</strong>
          </p>

          <p style={{ fontSize: 13, color: '#6b7280' }}>
            The order is recorded at these prices and is waiting to be paid — no payment has been
            taken. Taking the money, and the seller moving the order on to shipped and delivered,
            are the next pieces of the marketplace.
          </p>
        </>
      )}
    </main>
  )
}
