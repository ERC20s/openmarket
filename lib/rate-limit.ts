import { NextApiRequest } from 'next'

// Simple in-memory sliding window rate limiter. Keyed by client identifier
// (first x-forwarded-for entry || x-real-ip || req.socket?.remoteAddress || host || 'unknown').
// Not shared between processes — this is intentionally tiny and suitable for
// low-traffic cases and tests.

type Entry = number[] // timestamps in ms

const store: Map<string, Entry> = new Map()

function headerFirstIp(headerValue?: string | string[]): string | undefined {
  if (!headerValue) return undefined
  const val = Array.isArray(headerValue) ? headerValue.join(',') : headerValue
  const parts = val.split(',').map(p => p.trim()).filter(Boolean)
  return parts.length > 0 ? parts[0] : undefined
}

export function allowRequest(req: NextApiRequest, maxRequests = 10, windowMs = 60000): boolean {
  const headers = req.headers || {}
  const firstForwarded = headerFirstIp(headers['x-forwarded-for'] as string | string[] | undefined)
  const realIp = (headers['x-real-ip'] as string) || undefined
  const socketAddr = (req as any)?.socket?.remoteAddress as string | undefined
  const host = (headers['host'] as string) || undefined

  const rawKey = firstForwarded || realIp || socketAddr || host || 'unknown'
  const key = String(rawKey).trim()

  const now = Date.now()
  const cutoff = now - windowMs
  let entry = store.get(key)
  if (!entry) {
    entry = []
    store.set(key, entry)
  }

  // prune old timestamps
  while (entry.length > 0 && entry[0] <= cutoff) {
    entry.shift()
  }

  if (entry.length >= maxRequests) return false

  entry.push(now)
  return true
}

// For tests and deterministic behaviour: clear the in-memory store
export function resetRateLimit() {
  store.clear()
}
