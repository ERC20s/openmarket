// The one place that turns storefront state (search text, seller filter, page)
// into a GET /api/products URL, and reads it back off a router query object.
//
// The bounds here are exactly the ones pages/api/products.ts answers 422 on:
//   if (Number.isNaN(page) || page < 1 || Number.isNaN(size) || size < 1 || size > 100)
//   if (q && q.length > 100) -> 422 'Invalid query'
//   sellerId must parse and be >= 1 -> otherwise 422 'Invalid sellerId'
// Clamping here means a hand-edited URL never turns into a red error banner on
// the storefront; it lands on the nearest legal page instead.

export const DEFAULT_PAGE = 1
export const DEFAULT_SIZE = 20
export const MIN_SIZE = 1
export const MAX_SIZE = 100
export const MAX_Q_LENGTH = 100

/** Storefront state, already validated and safe to send to the API. */
export type ProductsQuery = {
  page: number
  size: number
  /** Trimmed search text; '' means "no search". */
  q: string
  /** Seller filter, or null for "all sellers". */
  sellerId: number | null
}

/** What next/router hands us: string | string[] | undefined per key. */
export type RouterQueryValue = string | string[] | undefined
export type RouterQueryLike = Record<string, RouterQueryValue>

export type ProductsQueryInput = {
  page?: number | string | null
  size?: number | string | null
  q?: string | null
  sellerId?: number | string | null
}

/** Repeated params (?q=a&q=b) arrive as an array; take the first one. */
function firstValue(value: RouterQueryValue): string | undefined {
  if (Array.isArray(value)) return value.length > 0 ? value[0] : undefined
  return value
}

function toInt(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : parseInt(value, 10)
  if (!Number.isFinite(parsed)) return null
  return Math.trunc(parsed)
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

/**
 * Normalise loose input into a ProductsQuery.
 *
 * - page: floored at 1, junk falls back to 1
 * - size: clamped to 1..100, junk falls back to 20
 * - q: trimmed and cut to 100 characters
 * - sellerId: a positive integer, or null (junk and 0 or less become null)
 */
export function normalizeProductsQuery(input: ProductsQueryInput = {}): ProductsQuery {
  const pageInt = toInt(input.page)
  const sizeInt = toInt(input.size)
  const sellerInt = toInt(input.sellerId)

  const q = typeof input.q === 'string' ? input.q.trim().slice(0, MAX_Q_LENGTH) : ''

  return {
    page: pageInt === null ? DEFAULT_PAGE : Math.max(DEFAULT_PAGE, pageInt),
    size: sizeInt === null ? DEFAULT_SIZE : clamp(sizeInt, MIN_SIZE, MAX_SIZE),
    q,
    sellerId: sellerInt === null || sellerInt < 1 ? null : sellerInt,
  }
}

/** Read the storefront state back off a next/router query object. */
export function parseProductsQuery(query: RouterQueryLike = {}): ProductsQuery {
  return normalizeProductsQuery({
    page: firstValue(query.page) ?? null,
    size: firstValue(query.size) ?? null,
    q: firstValue(query.q) ?? null,
    sellerId: firstValue(query.sellerId) ?? null,
  })
}

/**
 * The API URL for a given state: '/api/products?page=1&size=20' with q and
 * sellerId appended only when they are set, so an unfiltered load sends exactly
 * the request the storefront has always sent.
 */
export function buildProductsQuery(input: ProductsQueryInput = {}): string {
  const { page, size, q, sellerId } = normalizeProductsQuery(input)

  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('size', String(size))
  if (q) params.set('q', q)
  if (sellerId !== null) params.set('sellerId', String(sellerId))

  return `/api/products?${params.toString()}`
}

/**
 * The browser URL for the same state: '/' with only the parts that differ from
 * the defaults, so a plain first page stays a clean '/'.
 */
export function buildStorefrontHref(input: ProductsQueryInput = {}): string {
  const { page, size, q, sellerId } = normalizeProductsQuery(input)

  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (sellerId !== null) params.set('sellerId', String(sellerId))
  if (page !== DEFAULT_PAGE) params.set('page', String(page))
  if (size !== DEFAULT_SIZE) params.set('size', String(size))

  const search = params.toString()
  return search ? `/?${search}` : '/'
}

/**
 * The browser URL for one product: '/products/7' with the storefront state
 * appended, so the detail page can read the list the visitor came from back
 * with parseProductsQuery and send them to the exact page and filters again.
 *
 * Only the parts that differ from the defaults are carried, exactly as
 * buildStorefrontHref does, so a product opened from a clean first page is a
 * clean '/products/7'.
 *
 * An id that is not a positive integer is not a product the API can answer for
 * (pages/api/products/[id].ts answers 422 'Invalid id' on it), so rather than
 * link to /products/NaN this falls back to the storefront href for the same
 * state — a bad row in the list can never produce a broken link.
 */
export function buildProductHref(
  id: number | string | null | undefined,
  input: ProductsQueryInput = {}
): string {
  const productId = toInt(id)
  if (productId === null || productId < 1) return buildStorefrontHref(input)

  const href = buildStorefrontHref(input)
  const queryIndex = href.indexOf('?')
  const search = queryIndex === -1 ? '' : href.slice(queryIndex)

  return `/products/${productId}${search}`
}

/**
 * The browser URL for one seller: '/sellers/4' with only the paging that
 * differs from the defaults, so a seller opened from a storefront row is a
 * clean '/sellers/4'.
 *
 * Only page and size travel here: q and sellerId belong to the storefront
 * list, and the seller page has exactly one list — that seller's products,
 * paged by GET /api/sellers/<id>?page=&size=.
 *
 * An id that is not a positive integer is not a seller the API can answer for
 * (pages/api/sellers/[id].ts answers 422 'Invalid id' on it), so rather than
 * link to /sellers/NaN this falls back to the storefront href for the same
 * state, exactly as buildProductHref does.
 */
export function buildSellerHref(
  id: number | string | null | undefined,
  input: ProductsQueryInput = {}
): string {
  const sellerId = toInt(id)
  if (sellerId === null || sellerId < 1) return buildStorefrontHref(input)

  const { page, size } = normalizeProductsQuery(input)

  const params = new URLSearchParams()
  if (page !== DEFAULT_PAGE) params.set('page', String(page))
  if (size !== DEFAULT_SIZE) params.set('size', String(size))

  const search = params.toString()
  return search ? `/sellers/${sellerId}?${search}` : `/sellers/${sellerId}`
}

/** How many pages `total` rows fill at this size; always at least 1. */
export function pageCount(total: number, size: number): number {
  if (!Number.isFinite(total) || total <= 0) return 1
  const perPage = Number.isFinite(size) && size >= MIN_SIZE ? size : DEFAULT_SIZE
  return Math.max(1, Math.ceil(total / perPage))
}

/** True when any filter is active — drives the "Clear filters" link. */
export function hasFilters(query: ProductsQuery): boolean {
  return Boolean(query.q) || query.sellerId !== null
}
