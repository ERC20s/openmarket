import { describe, it, expect } from 'vitest'

import { formatPrice } from '../lib/format'

describe('formatPrice', () => {
  it('renders whole dollars and cents', () => {
    expect(formatPrice(1234)).toBe('$12.34')
    expect(formatPrice(100)).toBe('$1.00')
  })

  it('renders zero and sub-dollar amounts with two decimals', () => {
    expect(formatPrice(0)).toBe('$0.00')
    expect(formatPrice(5)).toBe('$0.05')
    expect(formatPrice(50)).toBe('$0.50')
  })

  it('keeps a sign for negatives and falls back to $0.00 for junk', () => {
    expect(formatPrice(-250)).toBe('-$2.50')
    expect(formatPrice(NaN)).toBe('$0.00')
    // Untyped rows coming back from JSON can carry anything.
    expect(formatPrice(undefined as unknown as number)).toBe('$0.00')
  })
})
