import { describe, it, expect } from 'vitest'
import { reqUrl, parsePageSize, parseIdFromPath, skipFor } from '../lib/api-helpers'

// These tests touch no database and no Prisma client: the helpers are pure.

function urlFor(path: string): URL {
  return new URL(path, 'http://localhost')
}

describe('reqUrl', () => {
  it('builds an absolute URL from req.url and the host header', () => {
    const url = reqUrl({ url: '/api/products?page=2', headers: { host: 'example.test' } } as any)
    expect(url.host).toBe('example.test')
    expect(url.pathname).toBe('/api/products')
    expect(url.searchParams.get('page')).toBe('2')
  })

  it('falls back to localhost and an empty path when url/host are missing', () => {
    const url = reqUrl({ url: undefined, headers: {} } as any)
    expect(url.host).toBe('localhost')
    expect(url.pathname).toBe('/')
  })
})

describe('parsePageSize', () => {
  it('defaults to page 1 and size 20', () => {
    const result = parsePageSize(urlFor('/api/products'))
    expect(result).toEqual({ ok: true, page: 1, size: 20 })
  })

  it('accepts valid page and size', () => {
    expect(parsePageSize(urlFor('/api/products?page=3&size=50'))).toEqual({
      ok: true,
      page: 3,
      size: 50,
    })
  })

  it('accepts size at the upper bound of 100', () => {
    const result = parsePageSize(urlFor('/api/products?size=100'))
    expect(result.ok).toBe(true)
  })

  for (const query of ['page=0', 'page=-1', 'page=abc', 'size=0', 'size=-1', 'size=101', 'size=abc']) {
    it(`rejects ?${query}`, () => {
      const result = parsePageSize(urlFor(`/api/products?${query}`))
      expect(result).toEqual({ ok: false, error: 'Invalid page or size' })
    })
  }
})

describe('parseIdFromPath', () => {
  it('reads the trailing path segment as the id', () => {
    expect(parseIdFromPath(urlFor('/api/products/42'))).toEqual({ ok: true, id: 42 })
  })

  it('ignores the query string', () => {
    expect(parseIdFromPath(urlFor('/api/sellers/7?page=2'))).toEqual({ ok: true, id: 7 })
  })

  for (const path of ['/api/products/abc', '/api/products/0', '/api/products/-3', '/api/products/']) {
    it(`rejects ${path}`, () => {
      expect(parseIdFromPath(urlFor(path))).toEqual({ ok: false, error: 'Invalid id' })
    })
  }
})

describe('skipFor', () => {
  it('is 0 on the first page and size*(page-1) after that', () => {
    expect(skipFor(1, 20)).toBe(0)
    expect(skipFor(3, 20)).toBe(40)
  })
})
