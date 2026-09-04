import { describe, it, expect } from 'vitest'
import { randomBytes } from 'crypto'

import {
  ORDER_STATUSES,
  INITIAL_ORDER_STATUS,
  applyTransition,
  canTransition,
  describeStatus,
  isOrderReference,
  isOrderStatus,
  isTerminal,
  newOrderReference,
  nextStatuses,
  orderTotal,
} from '../lib/orders'
import { groupLinesBySeller, normalizeRequestedLines, priceQuote, readBody } from '../lib/quote'

describe('order statuses', () => {
  it('starts pending and knows its own vocabulary', () => {
    expect(INITIAL_ORDER_STATUS).toBe('pending')
    expect([...ORDER_STATUSES]).toEqual(['pending', 'paid', 'shipped', 'delivered', 'cancelled'])
    expect(isOrderStatus('paid')).toBe(true)
    expect(isOrderStatus('refunded')).toBe(false)
    expect(isOrderStatus(null)).toBe(false)
  })

  it('walks the happy path pending -> paid -> shipped -> delivered', () => {
    expect(canTransition('pending', 'paid')).toBe(true)
    expect(canTransition('paid', 'shipped')).toBe(true)
    expect(canTransition('shipped', 'delivered')).toBe(true)
    expect(nextStatuses('pending')).toEqual(['paid', 'cancelled'])
    expect(nextStatuses('delivered')).toEqual([])
  })

  it('refuses to skip a step, to go backwards or to move a finished order', () => {
    expect(canTransition('pending', 'shipped')).toBe(false)
    expect(canTransition('shipped', 'paid')).toBe(false)
    expect(canTransition('delivered', 'cancelled')).toBe(false)
    expect(canTransition('cancelled', 'paid')).toBe(false)
    expect(canTransition('pending', 'pending')).toBe(false)
    expect(isTerminal('delivered')).toBe(true)
    expect(isTerminal('cancelled')).toBe(true)
    expect(isTerminal('pending')).toBe(false)
  })

  it('cancels only what has not shipped', () => {
    expect(canTransition('pending', 'cancelled')).toBe(true)
    expect(canTransition('paid', 'cancelled')).toBe(true)
    expect(canTransition('shipped', 'cancelled')).toBe(false)
  })

  it('applyTransition gives back the new status or the reason it was refused', () => {
    expect(applyTransition('pending', 'paid')).toEqual({ ok: true, status: 'paid' })

    const same = applyTransition('paid', 'paid')
    expect(same.ok).toBe(false)
    expect((same as any).error).toContain('already paid')

    const finished = applyTransition('delivered', 'shipped')
    expect(finished.ok).toBe(false)
    expect((finished as any).error).toContain('cannot change again')

    const wrong = applyTransition('pending', 'delivered')
    expect(wrong.ok).toBe(false)
    expect((wrong as any).error).toContain('from pending to delivered')

    const junk = applyTransition('pending', 'refunded')
    expect(junk.ok).toBe(false)
    expect((junk as any).error).toContain('Unknown order status')
  })

  it('labels every status, and unknown input, without throwing', () => {
    expect(describeStatus('pending')).toBe('Placed, not paid yet')
    expect(describeStatus('delivered')).toBe('Delivered')
    expect(describeStatus(undefined)).toBe('Unknown')
  })
})

describe('order references', () => {
  // The route injects node's crypto.randomBytes; lib/orders.ts must not import
  // it itself, because the confirmation page imports that file in the browser.
  const hex = (bytes: number) => randomBytes(bytes).toString('hex')

  it('makes an om_ token of 24 hex characters', () => {
    const reference = newOrderReference(hex)
    expect(reference).toMatch(/^om_[0-9a-f]{24}$/)
    expect(isOrderReference(reference)).toBe(true)
    expect(newOrderReference(hex)).not.toBe(reference)
  })

  it('pads, lowercases and strips a hand-supplied source', () => {
    const short = newOrderReference(() => 'AB')
    expect(short.startsWith('om_ab')).toBe(true)
    expect(short).toMatch(/^om_[0-9a-f]{24}$/)

    const junk = newOrderReference(() => 'z'.repeat(30))
    expect(junk).toBe('om_' + '0'.repeat(24))
    expect(newOrderReference(() => 'f'.repeat(40))).toBe('om_' + 'f'.repeat(24))
  })

  it('rejects anything that is not a reference, so a row id cannot be walked', () => {
    expect(isOrderReference('1')).toBe(false)
    expect(isOrderReference('om_123')).toBe(false)
    expect(isOrderReference('om_' + 'g'.repeat(24))).toBe(false)
    expect(isOrderReference(null)).toBe(false)
  })

  it('totals priced lines in whole cents and ignores junk', () => {
    expect(orderTotal([{ line_total: 2400 }, { line_total: 750 }])).toBe(3150)
    expect(orderTotal([{ line_total: null }, {} as any])).toBe(0)
    expect(orderTotal(undefined as any)).toBe(0)
  })
})

describe('lib/quote.ts, shared by /api/checkout and /api/orders', () => {
  it('reads a parsed body and a raw JSON string alike', () => {
    expect(readBody({ body: { lines: [] } })).toEqual({ lines: [] })
    expect(readBody({ body: '{"lines":[]}' })).toEqual({ lines: [] })
    expect(readBody({ body: 'not json' })).toBe(null)
    expect(readBody({ body: '' })).toBe(null)
  })

  it('clamps quantities, merges a repeated product and names the 422 reason', () => {
    const merged = normalizeRequestedLines({
      lines: [
        { productId: 3, quantity: 200 },
        { productId: 3, quantity: 1, price_cents: 500 },
      ],
    })
    expect(merged).toEqual({ requested: [{ productId: 3, quantity: 99, claimedPrice: null }] })

    expect(normalizeRequestedLines({})).toEqual({ error: 'Invalid lines' })
    expect(normalizeRequestedLines({ lines: [] })).toEqual({ error: 'Cart is empty' })
    expect(normalizeRequestedLines({ lines: [{ productId: 0 }] })).toEqual({ error: 'Invalid productId' })
    expect(normalizeRequestedLines({ lines: ['nope'] })).toEqual({ error: 'Invalid line' })
  })

  it('prices from the rows, not from the claim, and reports what moved', () => {
    const quote = priceQuote(
      [
        { productId: 1, quantity: 2, claimedPrice: 900 },
        { productId: 2, quantity: 1, claimedPrice: null },
        { productId: 9, quantity: 1, claimedPrice: 100 },
      ],
      [
        { id: 1, title: 'Mug', price_cents: 1200, sellerId: 4, seller: { id: 4, name: 'Acme' } },
        { id: 2, title: 'Pen', price_cents: 250, sellerId: 7, seller: { id: 7, name: 'Bodega' } },
      ]
    )

    expect(quote.total).toBe(2 * 1200 + 250)
    expect(quote.count).toBe(3)
    expect(quote.problems.map((problem) => problem.code)).toEqual(['price_changed', 'product_missing'])
    expect(quote.sellers.map((group) => [group.sellerId, group.subtotal])).toEqual([
      [4, 2400],
      [7, 250],
    ])
  })

  it('groups lines by seller in first-seen order', () => {
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
    expect(groups.map((group) => group.sellerId)).toEqual([7, 4])
    expect(groups[0].subtotal).toBe(150)
    expect(groups[0].lines).toHaveLength(2)
  })
})
