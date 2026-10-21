// Who is calling, and may they touch this row?
//
// Sellers: each seller can be issued an API token (`npm run seller:token -- <id>`).
// The caller sends it as `Authorization: Bearer <token>`; only its SHA-256 is
// stored (Seller.apiTokenHash), so a database leak does not leak usable tokens.
//
// Buyers: there are no buyer accounts. POST /api/orders gives the browser a
// random buyer token in an HttpOnly cookie (reusing one it already holds) and
// stores its SHA-256 on the order (Order.buyerTokenHash). Changing an order
// later needs that same cookie. Knowing an order reference is enough to read
// the confirmation page, never to change the order.
//
// The cart has no server side to guard: it lives in the buyer's own
// localStorage (lib/cart.ts) and POST /api/checkout only quotes it.

import { createHash, randomBytes, timingSafeEqual } from 'crypto'

export const BUYER_COOKIE = 'om_buyer'
/** One year: the order history outlives a browsing session. */
const BUYER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** 32 random bytes, base64url: 43 characters. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export type HeaderBag = Record<string, string | string[] | undefined>
type RequestLike = { headers?: HeaderBag; cookies?: Partial<Record<string, string>> }

export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export function isToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value)
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Constant-time comparison of two hex digests. */
export function sameHash(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

function header(req: RequestLike, name: string): string | undefined {
  const value = req.headers?.[name]
  return Array.isArray(value) ? value[0] : value
}

/** The bearer token on the request, if it is shaped like one we issue. */
export function bearerToken(req: RequestLike): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(header(req, 'authorization') ?? '')
  return match && isToken(match[1]) ? match[1] : undefined
}

/** One cookie's value. Next parses req.cookies; fall back to the raw header. */
export function readCookie(req: RequestLike, name: string): string | undefined {
  const parsed = req.cookies?.[name]
  if (typeof parsed === 'string') return parsed
  for (const part of (header(req, 'cookie') ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}

/** The buyer token this browser already holds, if it is a valid one. */
export function buyerToken(req: RequestLike): string | undefined {
  const value = readCookie(req, BUYER_COOKIE)
  return isToken(value) ? value : undefined
}

/**
 * Did the browser send this from another site? Browsers set Sec-Fetch-Site on
 * every request and a page cannot override it. A cross-site request never
 * carries the SameSite=Lax buyer cookie, so a route that hands out a cookie
 * must refuse it rather than mint a new one over the buyer's own.
 */
export function isCrossSite(req: RequestLike): boolean {
  return header(req, 'sec-fetch-site')?.trim().toLowerCase() === 'cross-site'
}

export function buyerCookie(token: string): string {
  const parts = [`${BUYER_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${BUYER_COOKIE_MAX_AGE}`]
  if (process.env.NODE_ENV === 'production') parts.push('Secure')
  return parts.join('; ')
}

type SellerLookup = {
  seller: { findUnique: (args: any) => Promise<{ id: number } | null> }
}

/** The seller the bearer token belongs to, or null when there is no valid token. */
export async function authenticateSeller(prisma: SellerLookup, req: RequestLike): Promise<{ id: number } | null> {
  const token = bearerToken(req)
  if (!token) return null
  const seller = await prisma.seller.findUnique({ where: { apiTokenHash: hashToken(token) }, select: { id: true } })
  return seller && typeof seller.id === 'number' ? { id: seller.id } : null
}

export const UNAUTHENTICATED = { error: 'Authentication required' } as const
export const FORBIDDEN = { error: 'Forbidden' } as const
