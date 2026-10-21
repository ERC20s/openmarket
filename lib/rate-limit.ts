import { isIP } from 'net'

// In-memory sliding-window rate limiter for POST /api/orders.
//
// Who is the client? The socket address — the one thing a caller cannot forge.
// X-Forwarded-For is read only when TRUSTED_PROXY names the proxy the request
// actually arrived from, and then only the hop that proxy appended (the
// rightmost entry it did not itself receive from another trusted proxy). The
// first entry is whatever the client typed, so keying on it would let anyone
// rotate a fake address per request and never be limited.
//
// Where are the counts kept? A bounded LRU: at most `maxEntries` clients, the
// least recently seen one evicted first, and every entry dropped once its window
// has passed. An attacker spraying addresses can push old entries out, but can
// never grow the map past the bound. Not shared between processes.

type RequestLike = {
  headers?: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string | null } | null
}

/** Strip the IPv4-mapped IPv6 prefix so ::ffff:10.0.0.1 and 10.0.0.1 are one client. */
export function normalizeIp(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  let ip = value.trim()
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1)
  if (ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7)
  return isIP(ip) ? ip : undefined
}

/** TRUSTED_PROXY is a comma-separated list of proxy addresses, e.g. "10.0.0.5, 10.0.0.6". */
export function parseTrustedProxies(value: string | undefined): Set<string> {
  const proxies = new Set<string>()
  for (const part of (value ?? '').split(',')) {
    const ip = normalizeIp(part)
    if (ip) proxies.add(ip)
  }
  return proxies
}

function forwardedHops(header: string | string[] | undefined): string[] {
  if (!header) return []
  const joined = Array.isArray(header) ? header.join(',') : header
  return joined.split(',').map((part) => part.trim()).filter(Boolean)
}

/**
 * The address to rate-limit on. Without trusted proxies it is the socket
 * address, full stop. With them, and only when the socket peer is one of them,
 * walk X-Forwarded-For from the right past any other trusted proxy and take the
 * first hop that is not one: the address a trusted proxy saw and appended.
 */
export function clientKey(req: RequestLike, trusted: Set<string> = parseTrustedProxies(process.env.TRUSTED_PROXY)): string {
  const socketIp = normalizeIp(req.socket?.remoteAddress ?? undefined)
  if (!socketIp) return 'unknown'
  if (!trusted.has(socketIp)) return socketIp

  const hops = forwardedHops(req.headers?.['x-forwarded-for'])
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = normalizeIp(hops[i])
    // A hop that is not an address was not written by a proxy we trust; stop
    // rather than skip past it to something further left the client wrote.
    if (!hop) return socketIp
    if (!trusted.has(hop)) return hop
  }
  return socketIp
}

export type RateLimiterOptions = {
  /** Requests allowed per client per window. */
  max: number
  windowMs: number
  /** Most clients tracked at once; the least recently seen is evicted beyond it. */
  maxEntries: number
  /** Injectable clock for tests. */
  now?: () => number
}

export class RateLimiter {
  private readonly entries = new Map<string, number[]>()
  private readonly max: number
  private readonly windowMs: number
  private readonly maxEntries: number
  private readonly now: () => number

  constructor(opts: RateLimiterOptions) {
    if (!(opts.max >= 1) || !(opts.windowMs > 0) || !(opts.maxEntries >= 1)) {
      throw new RangeError('RateLimiter needs max >= 1, windowMs > 0 and maxEntries >= 1')
    }
    this.max = Math.floor(opts.max)
    this.windowMs = opts.windowMs
    this.maxEntries = Math.floor(opts.maxEntries)
    this.now = opts.now ?? Date.now
  }

  /** Record a hit for `key` and say whether it is within the limit. */
  hit(key: string): { allowed: boolean; retryAfterMs: number } {
    const now = this.now()
    const cutoff = now - this.windowMs

    // Delete then re-insert: a Map iterates in insertion order, so this moves
    // the key to the most-recently-used end.
    const stamps = (this.entries.get(key) ?? []).filter((t) => t > cutoff)
    this.entries.delete(key)

    let allowed = false
    if (stamps.length < this.max) {
      stamps.push(now)
      allowed = true
    }
    this.entries.set(key, stamps)
    this.evict(cutoff)

    return { allowed, retryAfterMs: allowed ? 0 : Math.max(0, stamps[0] + this.windowMs - now) }
  }

  /** Clients currently tracked. */
  get size(): number {
    return this.entries.size
  }

  has(key: string): boolean {
    return this.entries.has(key)
  }

  clear(): void {
    this.entries.clear()
  }

  private evict(cutoff: number) {
    // TTL: drop expired entries from the least-recently-used end. Anything
    // more recent than the first live one was touched later, so stop there.
    for (const [key, stamps] of this.entries) {
      if (stamps.length > 0 && stamps[stamps.length - 1] > cutoff) break
      this.entries.delete(key)
    }
    // Bound: evict least recently used until within maxEntries.
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string
      this.entries.delete(oldest)
    }
  }
}

/** The limiter POST /api/orders uses: 10 orders per client per minute, 10k clients tracked. */
export const orderRateLimiter = new RateLimiter({ max: 10, windowMs: 60_000, maxEntries: 10_000 })

export function allowRequest(req: RequestLike, limiter: RateLimiter = orderRateLimiter) {
  return limiter.hit(clientKey(req))
}

// For tests: forget every client.
export function resetRateLimit() {
  orderRateLimiter.clear()
}
