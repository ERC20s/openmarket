import type { NextApiRequest } from 'next'

/**
 * Shared request-parsing helpers for the API routes under pages/api/.
 *
 * These are pure functions that return plain result objects — they never throw
 * and never touch the response. Each route decides the status code, so the
 * behaviour of the existing endpoints is unchanged.
 */

export type PageSizeResult =
  | { ok: true; page: number; size: number }
  | { ok: false; error: string }

export type IdResult = { ok: true; id: number } | { ok: false; error: string }

export const DEFAULT_PAGE = 1
export const DEFAULT_SIZE = 20
export const MAX_SIZE = 100

/**
 * Build the absolute URL for an incoming request, exactly as the routes did
 * inline: `new URL(req.url ?? '', 'http://' + (req.headers.host ?? 'localhost'))`.
 */
export function reqUrl(req: Pick<NextApiRequest, 'url' | 'headers'>): URL {
  const host = (req.headers && (req.headers.host as string | undefined)) ?? 'localhost'
  return new URL(req.url ?? '', `http://${host}`)
}

/**
 * Parse ?page and ?size. Defaults: page 1, size 20.
 * Valid when page >= 1 and 1 <= size <= 100; non-numeric values are rejected.
 */
export function parsePageSize(url: URL): PageSizeResult {
  const pageRaw = url.searchParams.get('page') ?? String(DEFAULT_PAGE)
  const sizeRaw = url.searchParams.get('size') ?? String(DEFAULT_SIZE)

  const page = parseInt(pageRaw, 10)
  const size = parseInt(sizeRaw, 10)

  if (Number.isNaN(page) || page < 1 || Number.isNaN(size) || size < 1 || size > MAX_SIZE) {
    return { ok: false, error: 'Invalid page or size' }
  }

  return { ok: true, page, size }
}

/**
 * Parse the trailing path segment as a positive integer id, e.g. /api/products/1.
 * A missing, non-numeric or < 1 segment (including a trailing slash) is invalid.
 */
export function parseIdFromPath(url: URL): IdResult {
  const parts = url.pathname.split('/')
  const last = parts[parts.length - 1]
  const id = parseInt(last, 10)

  if (Number.isNaN(id) || id < 1) {
    return { ok: false, error: 'Invalid id' }
  }

  return { ok: true, id }
}

/** Offset for a 1-based page of `size` rows. */
export function skipFor(page: number, size: number): number {
  return (page - 1) * size
}
