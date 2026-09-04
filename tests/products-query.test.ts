import { describe, it, expect } from 'vitest'

import {
  buildProductHref,
  buildProductsQuery,
  buildStorefrontHref,
  hasFilters,
  normalizeProductsQuery,
  pageCount,
  parseProductsQuery,
} from '../lib/products-query'

describe('buildProductsQuery', () => {
  it('sends the original unfiltered request when nothing is set', () => {
    expect(buildProductsQuery()).toBe('/api/products?page=1&size=20')
    expect(buildProductsQuery({ q: '', sellerId: null })).toBe('/api/products?page=1&size=20')
  })

  it('trims the search text and omits it when it is only whitespace', () => {
    expect(buildProductsQuery({ q: '  lamp  ' })).toBe('/api/products?page=1&size=20&q=lamp')
    expect(buildProductsQuery({ q: '   ' })).toBe('/api/products?page=1&size=20')
  })

  it('encodes the search text', () => {
    expect(buildProductsQuery({ q: 'red & blue' })).toBe(
      '/api/products?page=1&size=20&q=red+%26+blue'
    )
  })

  it('caps the search text at 100 characters, the API 422 boundary', () => {
    const long = 'a'.repeat(150)
    const url = buildProductsQuery({ q: long })
    expect(url).toBe(`/api/products?page=1&size=20&q=${'a'.repeat(100)}`)
  })

  it('adds sellerId only when it is a positive integer', () => {
    expect(buildProductsQuery({ sellerId: 7 })).toBe('/api/products?page=1&size=20&sellerId=7')
    expect(buildProductsQuery({ sellerId: '7' })).toBe('/api/products?page=1&size=20&sellerId=7')
    expect(buildProductsQuery({ sellerId: 0 })).toBe('/api/products?page=1&size=20')
    expect(buildProductsQuery({ sellerId: -3 })).toBe('/api/products?page=1&size=20')
    expect(buildProductsQuery({ sellerId: 'abc' })).toBe('/api/products?page=1&size=20')
  })

  it('clamps page and size to what the API accepts', () => {
    expect(buildProductsQuery({ page: 0 })).toBe('/api/products?page=1&size=20')
    expect(buildProductsQuery({ page: -5 })).toBe('/api/products?page=1&size=20')
    expect(buildProductsQuery({ page: 'nope' })).toBe('/api/products?page=1&size=20')
    expect(buildProductsQuery({ page: 3 })).toBe('/api/products?page=3&size=20')
    expect(buildProductsQuery({ size: 500 })).toBe('/api/products?page=1&size=100')
    expect(buildProductsQuery({ size: 0 })).toBe('/api/products?page=1&size=1')
  })

  it('combines search, seller and page', () => {
    expect(buildProductsQuery({ page: 2, size: 10, q: 'mug', sellerId: 4 })).toBe(
      '/api/products?page=2&size=10&q=mug&sellerId=4'
    )
  })
})

describe('parseProductsQuery', () => {
  it('reads defaults off an empty router query', () => {
    expect(parseProductsQuery()).toEqual({ page: 1, size: 20, q: '', sellerId: null })
    expect(parseProductsQuery({})).toEqual({ page: 1, size: 20, q: '', sellerId: null })
  })

  it('reads search, seller and page off the URL', () => {
    expect(parseProductsQuery({ q: ' mug ', sellerId: '4', page: '2' })).toEqual({
      page: 2,
      size: 20,
      q: 'mug',
      sellerId: 4,
    })
  })

  it('takes the first value when a param is repeated', () => {
    expect(parseProductsQuery({ q: ['mug', 'lamp'] }).q).toBe('mug')
    expect(parseProductsQuery({ page: [] }).page).toBe(1)
  })

  it('falls back instead of passing junk the API would 422 on', () => {
    expect(parseProductsQuery({ page: 'x', size: '9999', sellerId: 'x' })).toEqual({
      page: 1,
      size: 100,
      q: '',
      sellerId: null,
    })
  })
})

describe('buildStorefrontHref', () => {
  it('is a clean / for an unfiltered first page', () => {
    expect(buildStorefrontHref()).toBe('/')
    expect(buildStorefrontHref({ page: 1, size: 20 })).toBe('/')
  })

  it('carries only what differs from the defaults', () => {
    expect(buildStorefrontHref({ sellerId: 4 })).toBe('/?sellerId=4')
    expect(buildStorefrontHref({ q: 'mug', page: 2 })).toBe('/?q=mug&page=2')
    expect(buildStorefrontHref({ size: 50 })).toBe('/?size=50')
  })
})

describe('buildProductHref', () => {
  it('is a clean /products/<id> when nothing differs from the defaults', () => {
    expect(buildProductHref(7)).toBe('/products/7')
    expect(buildProductHref('7', { page: 1, size: 20 })).toBe('/products/7')
  })

  it('carries the storefront state so the back link can restore it', () => {
    expect(buildProductHref(7, { q: 'mug', page: 2 })).toBe('/products/7?q=mug&page=2')
    expect(buildProductHref(7, { sellerId: 4 })).toBe('/products/7?sellerId=4')
    expect(buildProductHref(7, { q: 'red & blue', sellerId: 4, page: 3, size: 50 })).toBe(
      '/products/7?q=red+%26+blue&sellerId=4&page=3&size=50'
    )
  })

  it('clamps the carried state the same way the storefront link does', () => {
    expect(buildProductHref(7, { page: 0, size: 500 })).toBe('/products/7?size=100')
    expect(buildProductHref(7, { q: '   ' })).toBe('/products/7')
  })

  it('falls back to the storefront href for an id the API would 422 on', () => {
    expect(buildProductHref('abc')).toBe('/')
    expect(buildProductHref(0)).toBe('/')
    expect(buildProductHref(-3)).toBe('/')
    expect(buildProductHref(null)).toBe('/')
    expect(buildProductHref(undefined, { sellerId: 4 })).toBe('/?sellerId=4')
  })

  it('round-trips through parseProductsQuery', () => {
    const href = buildProductHref(7, { q: 'mug', sellerId: 4, page: 2, size: 50 })
    const search = new URLSearchParams(href.slice(href.indexOf('?') + 1))
    expect(parseProductsQuery(Object.fromEntries(search))).toEqual({
      page: 2,
      size: 50,
      q: 'mug',
      sellerId: 4,
    })
  })
})

describe('pageCount and hasFilters', () => {
  it('counts pages and never returns zero', () => {
    expect(pageCount(0, 20)).toBe(1)
    expect(pageCount(57, 20)).toBe(3)
    expect(pageCount(20, 20)).toBe(1)
    expect(pageCount(21, 20)).toBe(2)
  })

  it('reports whether a filter is active', () => {
    expect(hasFilters(normalizeProductsQuery())).toBe(false)
    expect(hasFilters(normalizeProductsQuery({ q: 'mug' }))).toBe(true)
    expect(hasFilters(normalizeProductsQuery({ sellerId: 2 }))).toBe(true)
    expect(hasFilters(normalizeProductsQuery({ page: 3 }))).toBe(false)
  })
})
