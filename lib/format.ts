// Money helpers shared by the pages. Prices are stored as whole cents
// (prisma/schema.prisma: `price_cents Int`), so every render goes through here
// rather than doing its own division and rounding.

/**
 * Render an integer number of cents as a dollar string: 1234 -> "$12.34".
 *
 * Anything that is not a finite integer (undefined column, NaN from a bad
 * parse) renders as "$0.00" so a single bad row cannot blank the whole list.
 */
export function formatPrice(priceCents: number): string {
  if (typeof priceCents !== 'number' || !Number.isFinite(priceCents)) {
    return '$0.00'
  }

  const cents = Math.round(priceCents)
  const negative = cents < 0
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const remainder = String(abs % 100).padStart(2, '0')

  return `${negative ? '-' : ''}$${dollars}.${remainder}`
}
