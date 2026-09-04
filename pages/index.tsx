import { FormEvent, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'

import { formatPrice } from '../lib/format'
import { CART_CHANGED_EVENT, CART_STORAGE_KEY, cartCount, readStoredCart } from '../lib/cart'
import {
  buildProductHref,
  buildProductsQuery,
  buildSellerHref,
  buildStorefrontHref,
  hasFilters,
  pageCount,
  parseProductsQuery,
  type RouterQueryLike,
} from '../lib/products-query'

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

// The shape GET /api/sellers returns: { id, name } plus how many products the
// seller has (never the email column), ordered by name and capped at 100 rows.
type SellerOption = { id: number; name: string; productCount?: number }

type SellersResponse = {
  sellers: SellerOption[]
  total: number
}

// Four distinct states, so an empty shop never looks like a broken one:
// loading, error, loaded-but-empty, loaded-with-rows.
type Status = 'loading' | 'error' | 'ready'

export default function Home() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('loading')
  const [items, setItems] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  // The seller facet. An empty list means "no picker": the storefront must keep
  // working when /api/sellers fails, so a failure is not an error state here.
  const [sellers, setSellers] = useState<SellerOption[]>([])
  // How many items are in the cart. Starts at 0 so the first client render
  // matches the server markup; the effect below fills it in after hydration.
  const [cartItems, setCartItems] = useState(0)

  // The URL is the single source of truth for search, seller and page: every
  // link and the search form write to it, and the fetch below reads it back.
  const query = useMemo(
    () => parseProductsQuery(router.query as RouterQueryLike),
    [router.query]
  )

  // The text box is the one piece of local state — typing must not re-fetch, so
  // it only mirrors the URL when the URL itself changes.
  const [searchText, setSearchText] = useState(query.q)
  useEffect(() => {
    setSearchText(query.q)
  }, [query.q])

  useEffect(() => {
    // router.query is empty on the first (pre-hydration) render; waiting for
    // isReady stops a throwaway unfiltered fetch on every filtered page load.
    if (!router.isReady) return

    let cancelled = false
    setStatus('loading')

    fetch(buildProductsQuery(query))
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
    // Primitives, not the object: a new router.query identity with the same
    // values must not fire a second request.
  }, [router.isReady, query.page, query.size, query.q, query.sellerId])

  // The seller list never depends on the search or the page, so it is fetched
  // once. A failed fetch leaves the list empty and the picker hidden — search
  // and paging carry on, and ?sellerId=<id> typed by hand still works.
  useEffect(() => {
    let cancelled = false

    fetch('/api/sellers')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<SellersResponse>
      })
      .then((data) => {
        if (cancelled) return
        setSellers(Array.isArray(data.sellers) ? data.sellers : [])
      })
      .catch(() => {
        if (cancelled) return
        setSellers([])
      })

    return () => {
      cancelled = true
    }
  }, [])

  // The cart count. localStorage does not exist on the server, so it is only
  // ever read inside this effect; a write from another page of the app fires
  // CART_CHANGED_EVENT and another tab fires 'storage'.
  useEffect(() => {
    function refresh() {
      setCartItems(cartCount(readStoredCart()))
    }
    function onStorage(event: StorageEvent) {
      if (event.key === null || event.key === CART_STORAGE_KEY) refresh()
    }

    refresh()
    window.addEventListener(CART_CHANGED_EVENT, refresh)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(CART_CHANGED_EVENT, refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const filtered = hasFilters(query)
  // The list knows the name the filter banner could only show as an id. A
  // sellerId typed into the URL that is not in the list stays unresolved.
  const selectedSeller =
    query.sellerId === null ? null : sellers.find((seller) => seller.id === query.sellerId) ?? null
  const pages = pageCount(total, query.size)
  const firstRow = total === 0 ? 0 : (query.page - 1) * query.size + 1
  const lastRow = firstRow === 0 ? 0 : firstRow + items.length - 1

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // A new search always starts at page 1; the seller filter survives it.
    router.push(
      buildStorefrontHref({ q: searchText, sellerId: query.sellerId, size: query.size, page: 1 })
    )
  }

  function onSellerChange(value: string) {
    // '' is the "All sellers" option; picking a seller keeps the search and the
    // page size, and starts again at page 1 like any other new filter.
    const sellerId = value === '' ? null : parseInt(value, 10)
    router.push(
      buildStorefrontHref({ q: query.q, sellerId, size: query.size, page: 1 })
    )
  }

  return (
    <main style={{ font: '15px system-ui, sans-serif', maxWidth: 720, margin: '0 auto', padding: '32px 16px' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
        <h1 style={{ fontSize: 24, marginBottom: 4, flex: 1 }}>openmarket</h1>
        {/* The count is 0 until the effect has read localStorage, so the link
            is always here and never causes a hydration mismatch. */}
        <Link href="/cart" style={{ color: '#7c5cff', fontSize: 13 }}>
          Cart ({cartItems})
        </Link>
      </div>
      <p style={{ color: '#6b7280', marginTop: 0 }}>A multi-seller marketplace.</p>

      <form onSubmit={onSearch} style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
        <input
          type="search"
          name="q"
          value={searchText}
          maxLength={100}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder={'Search products…'}
          aria-label="Search products"
          style={{
            flex: 1,
            font: 'inherit',
            padding: '8px 10px',
            border: '1px solid #d1d5db',
            borderRadius: 8,
          }}
        />
        <button
          type="submit"
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
          Search
        </button>
      </form>

      {/* The seller facet. Hidden entirely when the list is empty or its fetch
          failed, so the storefront never shows a picker with nothing in it. */}
      {sellers.length > 0 && (
        <div style={{ margin: '0 0 16px' }}>
          <label htmlFor="sellerId" style={{ color: '#6b7280', fontSize: 13, marginRight: 8 }}>
            Seller
          </label>
          <select
            id="sellerId"
            name="sellerId"
            aria-label="Filter by seller"
            value={query.sellerId === null ? '' : String(query.sellerId)}
            onChange={(event) => onSellerChange(event.target.value)}
            style={{
              font: 'inherit',
              padding: '8px 10px',
              border: '1px solid #d1d5db',
              borderRadius: 8,
              background: '#fff',
            }}
          >
            <option value="">All sellers</option>
            {/* A sellerId from a hand-typed URL that is not in the list still
                needs an option, or the select would show the wrong seller. */}
            {query.sellerId !== null && selectedSeller === null && (
              <option value={String(query.sellerId)}>Seller #{query.sellerId}</option>
            )}
            {sellers.map((seller) => (
              <option key={seller.id} value={String(seller.id)}>
                {seller.name}
                {typeof seller.productCount === 'number' ? ` (${seller.productCount})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {filtered && (
        <p style={{ color: '#6b7280', fontSize: 13, marginTop: 0 }}>
          {query.q && <>Search: &ldquo;{query.q}&rdquo;. </>}
          {query.sellerId !== null && (
            <>
              {/* The name comes from the /api/sellers list when it loaded;
                  the id is the fallback, and either way the banner links to
                  that seller's page. */}
              <Link
                href={buildSellerHref(query.sellerId, { size: query.size })}
                style={{ color: '#7c5cff' }}
              >
                {selectedSeller?.name ?? `Seller #${query.sellerId}`}
              </Link>
              .{' '}
            </>
          )}
          <Link href={buildStorefrontHref({ size: query.size })} style={{ color: '#7c5cff' }}>
            Clear filters
          </Link>
        </p>
      )}

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

      {status === 'ready' && items.length === 0 && filtered && (
        <p style={{ color: '#6b7280' }}>
          No products match that search.{' '}
          <Link href={buildStorefrontHref({ size: query.size })} style={{ color: '#7c5cff' }}>
            Clear filters
          </Link>
        </p>
      )}

      {status === 'ready' && items.length === 0 && !filtered && query.page > 1 && (
        <p style={{ color: '#6b7280' }}>
          Nothing on page {query.page}.{' '}
          <Link href={buildStorefrontHref({ size: query.size })} style={{ color: '#7c5cff' }}>
            Back to the first page
          </Link>
        </p>
      )}

      {status === 'ready' && items.length === 0 && !filtered && query.page === 1 && (
        <p style={{ color: '#6b7280' }}>
          No products yet. Seed the database with npm run prisma:seed.
        </p>
      )}

      {status === 'ready' && items.length > 0 && (
        <>
          <p style={{ color: '#6b7280', fontSize: 13 }}>
            Showing {firstRow}&ndash;{lastRow} of {total} product{total === 1 ? '' : 's'}.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {items.map((product) => (
              <li key={product.id} style={{ borderTop: '1px solid #e5e7eb', padding: '12px 0' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                  <strong style={{ flex: 1 }}>
                    {/* The title opens the detail page and carries the current
                        search, seller and page, so "Back to results" returns
                        to this exact list. */}
                    <Link
                      href={buildProductHref(product.id, query)}
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
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  {/* The seller name opens that seller's page; the current page
                      size travels with it, the search and page do not — the
                      seller page is its own list. */}
                  <Link
                    href={buildSellerHref(product.sellerId, { size: query.size })}
                    style={{ color: '#7c5cff' }}
                  >
                    {product.seller?.name ?? `Seller #${product.sellerId}`}
                  </Link>
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
                href={buildStorefrontHref({ ...query, page: query.page - 1 })}
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
                href={buildStorefrontHref({ ...query, page: query.page + 1 })}
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
    </main>
  )
}
