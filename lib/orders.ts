// The order state machine, as data. Pure functions over a status string — no
// React, no Prisma — in the same style as lib/cart.ts and lib/quote.ts, so the
// rules are unit-tested without a database and every route or page that has to
// decide "can this order still be cancelled?" asks the same file.
//
// The status is stored as a plain String column (prisma/schema.prisma:
// `status String @default("pending")`) because the sqlite provider has no
// enums; this module is what keeps that column honest.
//
// Nothing here imports node's crypto (or anything else): pages/orders/[id].tsx
// imports this file too, and a node builtin in a lib the client bundles is a
// build error. The API route injects the random source instead.

/** Every status an order can hold, in the order it normally travels. */
export const ORDER_STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

/** What a freshly placed order is: written, priced, not paid for. */
export const INITIAL_ORDER_STATUS: OrderStatus = 'pending'

/** Where each status may go next. Anything not listed here is refused. */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value)
}

/** The statuses this one may move to. An unknown status can move nowhere. */
export function nextStatuses(from: unknown): OrderStatus[] {
  if (!isOrderStatus(from)) return []
  return [...TRANSITIONS[from]]
}

/** An order that will never move again: delivered or cancelled. */
export function isTerminal(status: unknown): boolean {
  return isOrderStatus(status) && TRANSITIONS[status].length === 0
}

/** May this order move from `from` to `to`? A move to the same status is not a move. */
export function canTransition(from: unknown, to: unknown): boolean {
  if (!isOrderStatus(from) || !isOrderStatus(to)) return false
  return TRANSITIONS[from].includes(to)
}

/**
 * Apply a transition. Returns the new status or the reason it was refused, so a
 * caller (a route, a seller dashboard action) can answer 409 with the message
 * instead of inventing its own wording.
 */
export function applyTransition(
  from: unknown,
  to: unknown
): { ok: true; status: OrderStatus } | { ok: false; error: string } {
  if (!isOrderStatus(from)) return { ok: false, error: `Unknown order status "${String(from)}".` }
  if (!isOrderStatus(to)) return { ok: false, error: `Unknown order status "${String(to)}".` }
  if (from === to) return { ok: false, error: `This order is already ${from}.` }
  if (!canTransition(from, to)) {
    return {
      ok: false,
      error: isTerminal(from)
        ? `An order that is ${from} cannot change again.`
        : `An order cannot go from ${from} to ${to}.`,
    }
  }
  return { ok: true, status: to }
}

/** A human label for a status, for the confirmation page and, later, the dashboard. */
export function describeStatus(status: unknown): string {
  switch (status) {
    case 'pending':
      return 'Placed, not paid yet'
    case 'paid':
      return 'Paid'
    case 'shipped':
      return 'Shipped'
    case 'delivered':
      return 'Delivered'
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'Unknown'
  }
}

// ---------------------------------------------------------------------------
// The public reference. An order is looked up by this, never by its row id, so
// a buyer cannot walk /orders/1, /orders/2 through everybody else's orders.
// It is an unguessable token, not authentication: the confirmation page shows
// only what was bought, and no buyer contact detail is stored on the order.
// ---------------------------------------------------------------------------

export const ORDER_REFERENCE_PREFIX = 'om_'

/** om_ plus 24 hex characters (12 random bytes). */
export const ORDER_REFERENCE_PATTERN = /^om_[0-9a-f]{24}$/

export function isOrderReference(value: unknown): boolean {
  return typeof value === 'string' && ORDER_REFERENCE_PATTERN.test(value)
}

/** Normalize any hex-ish string into the 24 characters a reference carries. */
export function formatOrderReference(hex: unknown): string {
  const clean = String(hex ?? '')
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '')
    .slice(0, 24)
    .padEnd(24, '0')
  return ORDER_REFERENCE_PREFIX + clean
}

/**
 * Make a new reference from an injected random source — the API route passes
 * node's crypto.randomBytes, and a test can pin the value. Never Math.random,
 * and never a node import in this file (see the header).
 */
export function newOrderReference(randomHex: (bytes: number) => string): string {
  return formatOrderReference(randomHex(12))
}

/** The total of a set of priced lines, in whole cents. */
export function orderTotal(lines: { line_total?: number | null }[]): number {
  if (!Array.isArray(lines)) return 0
  return lines.reduce((sum, line) => {
    const value = typeof line?.line_total === 'number' && Number.isFinite(line.line_total)
      ? Math.trunc(line.line_total)
      : 0
    return sum + value
  }, 0)
}

// ---------------------------------------------------------------------------
// Buyer-limited view of the state machine. The confirmation page runs in the
// browser and shows a "Cancel this order" button only when the buyer may ask
// for that move. For now the buyer may only cancel a freshly placed (pending)
// order; paid/shipped/delivered transitions remain seller-only and require a
// signed-in dashboard.
// ---------------------------------------------------------------------------
export function buyerNextStatuses(from: unknown): OrderStatus[] {
  if (!isOrderStatus(from)) return []
  // Only a pending order may be cancelled by the buyer.
  if (from === 'pending') return ['cancelled']
  return []
}
