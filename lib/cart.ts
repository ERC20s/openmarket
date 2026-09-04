// The cart, as data. Everything above the "Storage" heading at the bottom is a
// pure function over an array of lines — no React, no browser API — in the same
// style as lib/products-query.ts, so it is unit-testable without a DOM runner.
//
// A line is a snapshot of a product taken at the moment it was added: title,
// price and seller are copied in, not looked up. That is deliberate — the cart
// must render with the API down — and it is also the trade-off: a price that
// changes on the server goes stale in an old cart until checkout re-reads it
// from GET /api/products/<id>.
//
// Prices are whole cents everywhere (prisma/schema.prisma: `price_cents Int`);
// render them with formatPrice from lib/format.ts.

/** Where the cart lives in localStorage. Versioned: a future shape change bumps it. */
export const CART_STORAGE_KEY = 'openmarket.cart.v1'

/** Fired on window after every successful write, so a header count can refresh. */
export const CART_CHANGED_EVENT = 'openmarket:cart-changed'

export const MIN_QUANTITY = 1
export const MAX_QUANTITY = 99
/** More distinct products than this and the page is unusable anyway. */
export const MAX_LINES = 50

/** One product in the cart. */
export type CartLine = {
  productId: number
  title: string
  price_cents: number
  sellerId: number
  sellerName: string
  quantity: number
}

/** What the pages hand in: a product row, without a quantity yet. */
export type CartLineInput = {
  productId: number | string
  title?: string | null
  price_cents?: number | string | null
  sellerId?: number | string | null
  sellerName?: string | null
  quantity?: number | string | null
}

/** One seller's slice of the cart, for the per-seller subtotals on /cart. */
export type SellerGroup = {
  sellerId: number
  sellerName: string
  lines: CartLine[]
  subtotal: number
}

function toInt(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) return null
  return Math.trunc(parsed)
}

/**
 * Clamp a quantity to 1..99, exactly as normalizeProductsQuery clamps size to
 * 1..100: junk becomes 1 rather than an error, so a hand-edited storage blob or
 * a stuck spinner button can never produce NaN × $4.00.
 */
export function clampQuantity(value: number | string | null | undefined): number {
  const quantity = toInt(value)
  if (quantity === null) return MIN_QUANTITY
  if (quantity < MIN_QUANTITY) return MIN_QUANTITY
  if (quantity > MAX_QUANTITY) return MAX_QUANTITY
  return quantity
}

/**
 * Turn loose input into a CartLine, or null when it is not a product at all.
 *
 * A line needs a positive integer productId and a finite price; anything else
 * (a half-written row, a renamed field, junk typed into localStorage) is
 * dropped rather than rendered. A missing title or seller name is filled in
 * with the same "#<id>" fallback the storefront rows use.
 */
export function normalizeLine(input: CartLineInput | null | undefined): CartLine | null {
  if (!input || typeof input !== 'object') return null

  const productId = toInt(input.productId)
  if (productId === null || productId < 1) return null

  const price = toInt(input.price_cents)
  if (price === null || price < 0) return null

  const sellerId = toInt(input.sellerId)
  const title = typeof input.title === 'string' && input.title.trim() !== ''
    ? input.title.trim()
    : `Product #${productId}`
  const sellerName = typeof input.sellerName === 'string' && input.sellerName.trim() !== ''
    ? input.sellerName.trim()
    : sellerId === null || sellerId < 1
      ? 'Unknown seller'
      : `Seller #${sellerId}`

  return {
    productId,
    title,
    price_cents: price,
    sellerId: sellerId === null || sellerId < 1 ? 0 : sellerId,
    sellerName,
    quantity: clampQuantity(input.quantity ?? MIN_QUANTITY),
  }
}

/**
 * Add a product. A repeat add of the same productId merges into the existing
 * line (quantities summed, then clamped) instead of stacking a second row, and
 * the newer title/price snapshot wins so a re-add refreshes a stale line.
 *
 * Returns a new array; the input is never mutated.
 */
export function addLine(
  lines: CartLine[],
  input: CartLineInput,
  quantity: number | string | null | undefined = 1
): CartLine[] {
  const incoming = normalizeLine({ ...input, quantity: clampQuantity(quantity) })
  if (!incoming) return Array.isArray(lines) ? [...lines] : []

  const current = Array.isArray(lines) ? lines : []
  const index = current.findIndex((line) => line.productId === incoming.productId)

  if (index === -1) {
    // A cart that grows without bound is a broken page, not a feature.
    if (current.length >= MAX_LINES) return [...current]
    return [...current, incoming]
  }

  const next = [...current]
  next[index] = {
    ...incoming,
    quantity: clampQuantity(current[index].quantity + incoming.quantity),
  }
  return next
}

/** Set an exact quantity. 0 (or less) removes the line — the Remove button and the "0" input agree. */
export function setQuantity(
  lines: CartLine[],
  productId: number | string,
  quantity: number | string | null | undefined
): CartLine[] {
  const id = toInt(productId)
  const current = Array.isArray(lines) ? lines : []
  if (id === null) return [...current]

  const wanted = toInt(quantity)
  if (wanted !== null && wanted <= 0) return removeLine(current, id)

  return current.map((line) =>
    line.productId === id ? { ...line, quantity: clampQuantity(quantity) } : line
  )
}

/** Drop one line. An id that is not in the cart is not an error. */
export function removeLine(lines: CartLine[], productId: number | string): CartLine[] {
  const id = toInt(productId)
  const current = Array.isArray(lines) ? lines : []
  if (id === null) return [...current]
  return current.filter((line) => line.productId !== id)
}

/** The empty cart. */
export function clearCart(): CartLine[] {
  return []
}

/** Total number of items, quantities included — the number in the header link. */
export function cartCount(lines: CartLine[]): number {
  if (!Array.isArray(lines)) return 0
  return lines.reduce((sum, line) => sum + clampQuantity(line?.quantity), 0)
}

/** Grand total in whole cents. */
export function cartSubtotal(lines: CartLine[]): number {
  if (!Array.isArray(lines)) return 0
  return lines.reduce((sum, line) => {
    const normalized = normalizeLine(line)
    if (!normalized) return sum
    return sum + normalized.price_cents * normalized.quantity
  }, 0)
}

/**
 * Split the cart by seller, first-seen order, with each seller's subtotal.
 * This marketplace sells for many sellers at once, so /cart shows who each
 * line is bought from before it ever shows one total.
 */
export function groupBySeller(lines: CartLine[]): SellerGroup[] {
  const groups: SellerGroup[] = []
  if (!Array.isArray(lines)) return groups

  for (const raw of lines) {
    const line = normalizeLine(raw)
    if (!line) continue

    const existing = groups.find((group) => group.sellerId === line.sellerId)
    if (existing) {
      existing.lines.push(line)
      existing.subtotal += line.price_cents * line.quantity
      continue
    }

    groups.push({
      sellerId: line.sellerId,
      sellerName: line.sellerName,
      lines: [line],
      subtotal: line.price_cents * line.quantity,
    })
  }

  return groups
}

/**
 * Read a cart out of a JSON string. Anything that is not an array of usable
 * lines yields an empty cart, and a single malformed line is dropped rather
 * than taking the page down — the same "one bad row cannot blank the list"
 * rule formatPrice follows.
 */
export function parseCart(raw: string | null | undefined): CartLine[] {
  if (typeof raw !== 'string' || raw.trim() === '') return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  // Both the bare array and the { lines: [...] } envelope are accepted, so an
  // older or newer blob never wipes a cart on read.
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { lines?: unknown }).lines)
      ? ((parsed as { lines: unknown[] }).lines)
      : null
  if (!list) return []

  const lines: CartLine[] = []
  for (const entry of list) {
    const line = normalizeLine(entry as CartLineInput)
    if (!line) continue
    if (lines.some((existing) => existing.productId === line.productId)) continue
    if (lines.length >= MAX_LINES) break
    lines.push(line)
  }
  return lines
}

/** The JSON written back to storage. Always a bare array of normalized lines. */
export function serializeCart(lines: CartLine[]): string {
  const clean = Array.isArray(lines)
    ? lines.map((line) => normalizeLine(line)).filter((line): line is CartLine => line !== null)
    : []
  return JSON.stringify(clean)
}

// ---------------------------------------------------------------------------
// Storage. The only part of this file that knows a browser exists, kept here so
// three pages do not each write their own try/catch. Both helpers take an
// optional Storage-like object, which is what the tests pass in; with no
// argument they use window.localStorage when there is one and do nothing when
// there is not (server render, storage disabled, quota full).
// ---------------------------------------------------------------------------

/** The two methods of localStorage this module uses. */
export type CartStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function defaultStorage(): CartStorage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    // Safari in private mode throws on the property access itself.
    return null
  }
}

/** Read the saved cart. Never throws: an unreadable store is an empty cart. */
export function readStoredCart(storage?: CartStorage | null): CartLine[] {
  const store = storage === undefined ? defaultStorage() : storage
  if (!store) return []
  try {
    return parseCart(store.getItem(CART_STORAGE_KEY))
  } catch {
    return []
  }
}

/**
 * Save the cart and tell the rest of the page. Never throws: a full or disabled
 * store means the cart simply does not survive the reload, which is better than
 * a crashed Add to cart button. Returns whether the write succeeded.
 */
export function writeStoredCart(lines: CartLine[], storage?: CartStorage | null): boolean {
  const store = storage === undefined ? defaultStorage() : storage
  let saved = false
  if (store) {
    try {
      store.setItem(CART_STORAGE_KEY, serializeCart(lines))
      saved = true
    } catch {
      saved = false
    }
  }

  // The header count on another mounted page listens for this.
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT, { detail: { count: cartCount(lines) } }))
    }
  } catch {
    // An environment without CustomEvent is not a reason to lose the write.
  }

  return saved
}
