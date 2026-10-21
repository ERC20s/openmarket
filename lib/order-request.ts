// What /checkout posts to POST /api/orders. Kept apart from lib/quote.ts, which
// imports zod through lib/validation.ts: this file ships to the browser, so it
// imports nothing at runtime (the QuoteLine import is a type and is erased).

import type { QuoteLine } from './quote'

/** One line of the body POST /api/orders takes: the id, the quantity and the price claim. */
export type OrderRequestLine = { productId: number; quantity: number; price_cents: number }

/**
 * The body the review page posts to POST /api/orders once the buyer has seen
 * a quote: the quoted lines, each claiming the price the quote showed.
 *
 * It is built from the quote, never from the cart snapshot, because the
 * snapshot is exactly what the quote corrected: a line whose price moved
 * would re-send the old price as its claim, the server would answer 409 again,
 * and the buyer could never place the order. A product the quote dropped as
 * missing is not in the quote's lines, so it is not asked for either. If the
 * price moves again between the review and the click the claim is stale once
 * more and the server still answers 409 — that is the check doing its job.
 */
export function orderRequestFromQuote(quote: { lines: QuoteLine[] }): { lines: OrderRequestLine[] } {
  const lines = Array.isArray(quote?.lines) ? quote.lines : []
  return {
    lines: lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      price_cents: line.price_cents,
    })),
  }
}
