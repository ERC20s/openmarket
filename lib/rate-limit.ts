import { NextApiRequest } from 'next'

// Simple in-memory sliding window rate limiter. Keyed by client identifier
// (x-forwarded-for || x-real-ip || host || 'unknown'). Not shared between
// processes — this is intentionally tiny and suitable for low-traffic cases and
// tests.

type Entry = number[] // timestamps in ms

const store: Map<string, Entry> = new Map()

export function allowRequest(req: NextApiRequest, maxRequests = 10, windowMs = 60000): boolean {
  const headers = req.headers || {}
  const key = (headers['x-forwarded-for'] as string) || (headers['x-real-ip'] as string) || (headers['host'] as string) || 'unknown'
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
