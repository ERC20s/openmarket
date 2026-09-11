import { NextApiRequest } from 'next'

// Simple in-memory sliding-window rate limiter. Per-process only.
// Keyed by a string derived from request headers; defaults are conservative
// and easy to adjust in calls. A production deployment should replace this
// with a shared store (Redis) if a global limit is required.

type Store = Map<string, number[]>
const store: Store = new Map()

export function _keyFromReq(req: Partial<NextApiRequest>) {
  const headers = (req && (req as any).headers) || {}
  const forward = (headers['x-forwarded-for'] || headers['x-real-ip'] || headers['host'] || 'unknown')
  // x-forwarded-for may be a comma list; pick the first
  const key = String(forward).split(',')[0].trim()
  return key || 'unknown'
}

export function allowRequest(req: Partial<NextApiRequest>, maxRequests = 10, windowMs = 60_000): boolean {
  const key = _keyFromReq(req)
  const now = Date.now()
  const windowStart = now - windowMs
  const arr = store.get(key) || []
  const recent = arr.filter((t) => t > windowStart)
  if (recent.length >= maxRequests) {
    // stay unchanged
    return false
  }
  recent.push(now)
  store.set(key, recent)
  return true
}

// Test helper: reset the in-memory store. Not exported as default behaviour
// for production, only used by tests.
export function resetRateLimit() {
  store.clear()
}
