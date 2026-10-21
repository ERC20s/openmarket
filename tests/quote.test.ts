import { describe, it, expect } from 'vitest'

import {
  toInt,
  readBody,
  normalizeRequestedLines,
  orderRequestFromQuote,
  requestedIds,
  groupLinesBySeller,
  priceQuote,
} from '../lib/quote'

describe('lib/quote.ts unit helpers', () => {
  it('toInt handles numbers, numeric strings, floats and junk', () => {
    expect(toInt(5)).toBe(5)
    expect(toInt('12')).toBe(12)
    expect(toInt('3.7')).toBe(3)
    expect(toInt(3.7)).toBeNull()
    expect(toInt('')).toBeNull()
    expect(toInt(null)).toBeNull()
    expect(toInt('abc')).toBeNull()
  })

  it('readBody accepts parsed bodies and raw JSON strings, rejects bad JSON', () => {
    expect(readBody({ body: { lines: [] } })).toEqual({ lines: [] })
    expect(readBody({ body: '{"lines":[]}' })).toEqual({ lines: [] })
    expect(readBody({ body: 'not json' })).toBeNull()
    expect(readBody({ body: '' })).toBeNull()
  })

  it('normalizeRequestedLines merges repeated products, clamps the merged quantity and reports errors', () => {
    const merged = normalizeRequestedLines({
      lines: [
        { productId: 3, quantity: 60 },
        { productId: 3, quantity: 50, price_cents: 500 },
      ],
    })
    // The first line made no price claim, so the later line's claim is kept:
    // dropping it would let a moved price reach POST /api/orders unflagged.
    expect(merged).toEqual({ requested: [{ productId: 3, quantity: 99, claimedPrice: 500 }] })

    expect(normalizeRequestedLines({})).toEqual({ error: 'Invalid lines' })
    expect(normalizeRequestedLines({ lines: [] })).toEqual({ error: 'Cart is empty' })
    expect(normalizeRequestedLines({ lines: [{ productId: 0 }] })).toEqual({ error: 'Invalid productId' })
    expect(normalizeRequestedLines({ lines: ['nope'] })).toEqual({ error: 'Invalid line' })
    // Each line's own quantity must be 1..99 — only a merge is clamped.
    expect(normalizeRequestedLines({ lines: [{ productId: 3, quantity: 200 }] })).toEqual({ error: 'Invalid quantity' })
    expect(normalizeRequestedLines({ lines: [{ productId: 3, quantity: 0 }] })).toEqual({ error: 'Invalid quantity' })

    // Too many lines ( > MAX_LINES ) should be rejected. Create 51 lines.
    const many = { lines: Array.from({ length: 51 }, (_, i) => ({ productId: i + 1 })) }
    expect(normalizeRequestedLines(many)).toEqual({ error: 'Too many lines' })

    // Raw JSON string body should be parsed by readBody before normalization.
    const raw = JSON.stringify({ lines: [{ productId: 1, quantity: 2 }] })
    const parsed = readBody({ body: raw })
    expect(normalizeRequestedLines(parsed)).toEqual({ requested: [{ productId: 1, quantity: 2, claimedPrice: null }] })
  })

  it('requestedIds preserves first-seen order', () => {
    const requested = [
      { productId: 3, quantity: 1, claimedPrice: null },
      { productId: 1, quantity: 2, claimedPrice: null },
      { productId: 2, quantity: 1, claimedPrice: null },
    ]
    expect(requestedIds(requested)).toEqual([3, 1, 2])
  })

  it('groupLinesBySeller groups in first-seen order and sums subtotals', () => {
    const line = (productId: number, sellerId: number, total: number) => ({
      productId,
      title: `P${productId}`,
      price_cents: total,
      quantity: 1,
      line_total: total,
      sellerId,
      sellerName: `S${sellerId}`,
    })

    const groups = groupLinesBySeller([line(1, 7, 100), line(2, 4, 200), line(3, 7, 50)])
    expect(groups.map((g) => g.sellerId)).toEqual([7, 4])
    expect(groups[0].subtotal).toBe(150)
    expect(groups[0].lines).toHaveLength(2)
  })

  it('priceQuote reports product_missing, price_changed and falls back titles and seller names', () => {
    const requested = [
      { productId: 1, quantity: 2, claimedPrice: 900 }, // price changed
      { productId: 2, quantity: 1, claimedPrice: null },
      { productId: 9, quantity: 1, claimedPrice: 100 }, // missing
      { productId: 10, quantity: 1, claimedPrice: null }, // missing title and seller
      { productId: 11, quantity: 1, claimedPrice: null }, // missing seller name but has sellerId
    ]

    const rows = [
      { id: 1, /* title */ price_cents: 1200, sellerId: 4, seller: { id: 4, name: 'Acme' } },
      { id: 2, title: 'Pen', price_cents: 250, sellerId: 7, seller: { id: 7, name: 'Bodega' } },
      // product 10: no title, no seller
      { id: 10, price_cents: 333, /* sellerId missing */ },
      // product 11: has sellerId but no seller.name
      { id: 11, title: 'NoNameSellerProduct', price_cents: 400, sellerId: 22, seller: { id: 22 } },
    ]

    const quote = priceQuote(requested as any, rows as any)

    // totals: product 1 => 2 * 1200, product 2 => 250, product 10 => 333, product 11 => 400
    expect(quote.total).toBe(2 * 1200 + 250 + 333 + 400)
    expect(quote.count).toBe(2 + 1 + 1 + 1) // product 9 was missing

    // problems should include price_changed for id 1 and product_missing for id 9
    expect(quote.problems.map((p) => p.code).sort()).toEqual(['price_changed', 'product_missing'].sort())

    // Check fallbacks for title and sellerName
    const p10 = quote.lines.find((l) => l.productId === 10)!
    expect(p10.title).toBe('Product #10')
    expect(p10.sellerName).toBe('Unknown seller')

    const p11 = quote.lines.find((l) => l.productId === 11)!
    expect(p11.sellerName).toBe('Seller #22')
  })

  it('orderRequestFromQuote asks for the quoted lines at the quoted prices, never the stale snapshot', () => {
    const rows = [
      { id: 1, title: 'Mug', price_cents: 1500, sellerId: 4, seller: { id: 4, name: 'Acme' } },
      { id: 2, title: 'Pen', price_cents: 250, sellerId: 7, seller: { id: 7, name: 'Bodega' } },
    ]
    // The cart snapshot: product 1 was 1200 when it was added, product 9 has been delisted.
    const snapshot = { lines: [{ productId: 1, quantity: 2, price_cents: 1200 }, { productId: 2, quantity: 1, price_cents: 250 }, { productId: 9, quantity: 1, price_cents: 100 }] }
    const reviewed = normalizeRequestedLines(snapshot)
    if ('error' in reviewed) throw new Error(reviewed.error)
    const quote = priceQuote(reviewed.requested, rows)
    expect(quote.problems.map((problem) => problem.code)).toEqual(['price_changed', 'product_missing'])

    const request = orderRequestFromQuote(quote)
    expect(request).toEqual({
      lines: [
        { productId: 1, quantity: 2, price_cents: 1500 },
        { productId: 2, quantity: 1, price_cents: 250 },
      ],
    })

    // Posting that to POST /api/orders prices clean: the claims match the rows
    // and the delisted product is not asked for, so the order can be placed.
    const again = normalizeRequestedLines(request)
    if ('error' in again) throw new Error(again.error)
    const placed = priceQuote(again.requested, rows)
    expect(placed.problems).toEqual([])
    expect(placed.total).toBe(2 * 1500 + 250)

    // Whereas re-posting the snapshot, as the page used to, is refused again.
    expect(priceQuote(reviewed.requested, rows).problems).not.toEqual([])

    expect(orderRequestFromQuote({ lines: [] })).toEqual({ lines: [] })
  })
})
