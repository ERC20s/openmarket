import { describe, it, expect } from 'vitest'

import { RateLimiter, clientKey, normalizeIp, parseTrustedProxies } from '../lib/rate-limit'

// A clock the test moves by hand.
function clock(start = 1_000_000) {
  let now = start
  return { now: () => now, advance: (ms: number) => { now += ms } }
}

function req(remoteAddress: string | undefined, forwardedFor?: string | string[]) {
  return {
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
    socket: { remoteAddress },
  }
}

describe('RateLimiter', () => {
  it('allows max hits per window, refuses the next with a retry delay, and allows again once the window passes', () => {
    const time = clock()
    const limiter = new RateLimiter({ max: 3, windowMs: 1000, maxEntries: 10, now: time.now })

    expect(limiter.hit('a').allowed).toBe(true)
    time.advance(100)
    expect(limiter.hit('a').allowed).toBe(true)
    expect(limiter.hit('a').allowed).toBe(true)

    const refused = limiter.hit('a')
    expect(refused.allowed).toBe(false)
    // The oldest hit was 100ms ago: it leaves the window in 900ms.
    expect(refused.retryAfterMs).toBe(900)

    time.advance(900)
    expect(limiter.hit('a').allowed).toBe(true)
  })

  it('never tracks more than maxEntries clients and evicts the least recently seen first', () => {
    const time = clock()
    const limiter = new RateLimiter({ max: 1, windowMs: 60_000, maxEntries: 3, now: time.now })

    limiter.hit('a')
    limiter.hit('b')
    limiter.hit('c')
    // Touch "a" so "b" becomes the least recently used.
    limiter.hit('a')
    limiter.hit('d')

    expect(limiter.size).toBe(3)
    expect(limiter.has('b')).toBe(false)
    expect(limiter.has('a')).toBe(true)
    expect(limiter.has('c')).toBe(true)
    expect(limiter.has('d')).toBe(true)

    // A spray of fresh addresses cannot grow the map past the bound.
    for (let i = 0; i < 1000; i++) limiter.hit(`spray-${i}`)
    expect(limiter.size).toBe(3)
  })

  it('drops entries whose window has passed (TTL) even under the bound', () => {
    const time = clock()
    const limiter = new RateLimiter({ max: 1, windowMs: 1000, maxEntries: 100, now: time.now })

    limiter.hit('a')
    limiter.hit('b')
    time.advance(1001)
    limiter.hit('c')

    expect(limiter.has('a')).toBe(false)
    expect(limiter.has('b')).toBe(false)
    expect(limiter.size).toBe(1)
  })

  it('refuses nonsensical options', () => {
    expect(() => new RateLimiter({ max: 0, windowMs: 1000, maxEntries: 1 })).toThrow(RangeError)
    expect(() => new RateLimiter({ max: 1, windowMs: 0, maxEntries: 1 })).toThrow(RangeError)
    expect(() => new RateLimiter({ max: 1, windowMs: 1000, maxEntries: 0 })).toThrow(RangeError)
  })
})

describe('clientKey', () => {
  const none = new Set<string>()
  const trusted = parseTrustedProxies('10.0.0.5, 10.0.0.6')

  it('uses the socket address and ignores a spoofed X-Forwarded-For when no proxy is trusted', () => {
    expect(clientKey(req('198.51.100.7', '1.2.3.4'), none)).toBe('198.51.100.7')
    expect(clientKey(req('198.51.100.7', ['1.2.3.4', '5.6.7.8']), none)).toBe('198.51.100.7')
  })

  it('ignores X-Forwarded-For from a peer that is not a trusted proxy', () => {
    expect(clientKey(req('198.51.100.7', '1.2.3.4, 10.0.0.5'), trusted)).toBe('198.51.100.7')
  })

  it('takes the hop the trusted proxy appended, never the first entry', () => {
    expect(clientKey(req('10.0.0.5', '1.2.3.4, 203.0.113.9'), trusted)).toBe('203.0.113.9')
    // Two trusted proxies in a row: skip the inner one too.
    expect(clientKey(req('10.0.0.5', '1.2.3.4, 203.0.113.9, 10.0.0.6'), trusted)).toBe('203.0.113.9')
    // Repeated headers arrive as an array; the last hop is still the last.
    expect(clientKey(req('10.0.0.5', ['1.2.3.4', '203.0.113.9']), trusted)).toBe('203.0.113.9')
  })

  it('falls back to the socket address when the trusted proxy sent no usable hop', () => {
    expect(clientKey(req('10.0.0.5'), trusted)).toBe('10.0.0.5')
    expect(clientKey(req('10.0.0.5', 'not-an-ip'), trusted)).toBe('10.0.0.5')
    expect(clientKey(req('10.0.0.5', '10.0.0.6'), trusted)).toBe('10.0.0.5')
  })

  it('treats an IPv4-mapped IPv6 socket address as the IPv4 address', () => {
    expect(clientKey(req('::ffff:10.0.0.5', '1.2.3.4, 203.0.113.9'), trusted)).toBe('203.0.113.9')
    expect(clientKey(req('::ffff:198.51.100.7'), none)).toBe('198.51.100.7')
  })

  it('reads TRUSTED_PROXY from the environment by default', () => {
    const saved = process.env.TRUSTED_PROXY
    try {
      delete process.env.TRUSTED_PROXY
      expect(clientKey(req('10.0.0.5', '1.2.3.4, 203.0.113.9'))).toBe('10.0.0.5')
      process.env.TRUSTED_PROXY = '10.0.0.5'
      expect(clientKey(req('10.0.0.5', '1.2.3.4, 203.0.113.9'))).toBe('203.0.113.9')
    } finally {
      if (saved === undefined) delete process.env.TRUSTED_PROXY
      else process.env.TRUSTED_PROXY = saved
    }
  })

  it('normalizes and parses addresses', () => {
    expect(normalizeIp(' [2001:db8::1] ')).toBe('2001:db8::1')
    expect(normalizeIp('nope')).toBeUndefined()
    expect([...parseTrustedProxies('10.0.0.5,, junk ,::ffff:10.0.0.6')]).toEqual(['10.0.0.5', '10.0.0.6'])
  })
})
