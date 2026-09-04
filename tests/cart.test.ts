import { describe, it, expect } from 'vitest'

import {
  CART_STORAGE_KEY,
  MAX_QUANTITY,
  addLine,
  cartCount,
  cartSubtotal,
  clampQuantity,
  clearCart,
  groupBySeller,
  normalizeLine,
  parseCart,
  readStoredCart,
  removeLine,
  serializeCart,
  setQuantity,
  writeStoredCart,
  type CartLine,
  type CartStorage,
} from '../lib/cart'

// A product as the pages hand it in, straight off GET /api/products/<id>.
const mug = {
  productId: 1,
  title: 'Blue mug',
  price_cents: 1250,
  sellerId: 4,
  sellerName: 'Kiln & Co',
}

const lamp = {
  productId: 2,
  title: 'Desk lamp',
  price_cents: 4000,
  sellerId: 9,
  sellerName: 'Bright Things',
}

/** A localStorage stand-in, so these tests need no DOM. */
function memoryStorage(initial?: string): CartStorage & { value: string | null } {
  return {
    value: initial ?? null,
    getItem(key: string) {
      return key === CART_STORAGE_KEY ? this.value : null
    },
    setItem(key: string, value: string) {
      if (key === CART_STORAGE_KEY) this.value = value
    },
  }
}

describe('addLine', () => {
  it('adds a product with quantity 1', () => {
    const cart = addLine([], mug)
    expect(cart).toHaveLength(1)
    expect(cart[0]).toMatchObject({ productId: 1, title: 'Blue mug', price_cents: 1250, quantity: 1 })
  })

  it('merges a repeat add into the same line instead of stacking rows', () => {
    const cart = addLine(addLine([], mug), mug, 2)
    expect(cart).toHaveLength(1)
    expect(cart[0].quantity).toBe(3)
  })

  it('refreshes the snapshot when the same product is added again at a new price', () => {
    const cart = addLine(addLine([], mug), { ...mug, price_cents: 1500, title: 'Blue mug (v2)' })
    expect(cart[0].price_cents).toBe(1500)
    expect(cart[0].title).toBe('Blue mug (v2)')
  })

  it('keeps different products as separate lines', () => {
    const cart = addLine(addLine([], mug), lamp)
    expect(cart.map((line) => line.productId)).toEqual([1, 2])
  })

  it('never mutates the array it was given', () => {
    const before: CartLine[] = []
    addLine(before, mug)
    expect(before).toHaveLength(0)
  })

  it('ignores a row that is not a product', () => {
    expect(addLine([], { productId: 0, price_cents: 100 })).toHaveLength(0)
    expect(addLine([], { productId: 'abc', price_cents: 100 })).toHaveLength(0)
    expect(addLine([], { productId: 5, price_cents: 'free' })).toHaveLength(0)
  })
})

describe('clampQuantity', () => {
  it('clamps to 1..99 and turns junk into 1', () => {
    expect(clampQuantity(0)).toBe(1)
    expect(clampQuantity(-4)).toBe(1)
    expect(clampQuantity(7)).toBe(7)
    expect(clampQuantity(500)).toBe(MAX_QUANTITY)
    expect(clampQuantity('abc')).toBe(1)
    expect(clampQuantity(null)).toBe(1)
  })

  it('clamps a merged quantity that would run past the cap', () => {
    const cart = addLine(addLine([], mug, 90), mug, 90)
    expect(cart[0].quantity).toBe(MAX_QUANTITY)
  })
})

describe('setQuantity and removeLine', () => {
  const cart = addLine(addLine([], mug), lamp)

  it('sets an exact quantity', () => {
    expect(setQuantity(cart, 1, 5)[0].quantity).toBe(5)
  })

  it('removes the line when the quantity is 0 or less', () => {
    expect(setQuantity(cart, 1, 0).map((line) => line.productId)).toEqual([2])
    expect(setQuantity(cart, 1, -3).map((line) => line.productId)).toEqual([2])
  })

  it('clamps a hand-typed quantity rather than storing NaN', () => {
    expect(setQuantity(cart, 1, '')[0].quantity).toBe(1)
    expect(setQuantity(cart, 1, 900)[0].quantity).toBe(MAX_QUANTITY)
  })

  it('removes one line and leaves an unknown id alone', () => {
    expect(removeLine(cart, 2).map((line) => line.productId)).toEqual([1])
    expect(removeLine(cart, 77)).toHaveLength(2)
  })

  it('clearCart empties it', () => {
    expect(clearCart()).toEqual([])
  })
})

describe('cartCount and cartSubtotal', () => {
  it('counts quantities, not rows', () => {
    const cart = addLine(addLine([], mug, 3), lamp, 2)
    expect(cartCount(cart)).toBe(5)
  })

  it('totals price x quantity in whole cents', () => {
    const cart = addLine(addLine([], mug, 3), lamp, 2)
    expect(cartSubtotal(cart)).toBe(1250 * 3 + 4000 * 2)
  })

  it('is 0 for an empty or junk cart', () => {
    expect(cartCount([])).toBe(0)
    expect(cartSubtotal([])).toBe(0)
    expect(cartCount(null as unknown as CartLine[])).toBe(0)
    expect(cartSubtotal(null as unknown as CartLine[])).toBe(0)
  })
})

describe('groupBySeller', () => {
  it('splits the cart by seller with a subtotal each, in first-seen order', () => {
    const cart = addLine(addLine(addLine([], mug, 2), lamp), { ...mug, productId: 3, title: 'Green mug' })
    const groups = groupBySeller(cart)

    expect(groups.map((group) => group.sellerId)).toEqual([4, 9])
    expect(groups[0].sellerName).toBe('Kiln & Co')
    expect(groups[0].lines.map((line) => line.productId)).toEqual([1, 3])
    expect(groups[0].subtotal).toBe(1250 * 2 + 1250)
    expect(groups[1].subtotal).toBe(4000)
  })
})

describe('normalizeLine', () => {
  it('fills in the "#<id>" fallbacks the storefront rows use', () => {
    const line = normalizeLine({ productId: 8, price_cents: 100, sellerId: 3 })
    expect(line).toMatchObject({ title: 'Product #8', sellerName: 'Seller #3' })
  })

  it('rejects a row with no usable id or price', () => {
    expect(normalizeLine(null)).toBeNull()
    expect(normalizeLine({ productId: -1, price_cents: 100 })).toBeNull()
    expect(normalizeLine({ productId: 1, price_cents: -50 })).toBeNull()
  })
})

describe('parseCart', () => {
  it('reads back what serializeCart wrote', () => {
    const cart = addLine(addLine([], mug, 2), lamp)
    expect(parseCart(serializeCart(cart))).toEqual(cart)
  })

  it('returns an empty cart for junk from storage', () => {
    expect(parseCart(null)).toEqual([])
    expect(parseCart('')).toEqual([])
    expect(parseCart('not json')).toEqual([])
    expect(parseCart('{"lines":"nope"}')).toEqual([])
    expect(parseCart('42')).toEqual([])
  })

  it('drops the malformed lines and keeps the good ones', () => {
    const raw = JSON.stringify([
      { productId: 1, title: 'Blue mug', price_cents: 1250, sellerId: 4, sellerName: 'Kiln & Co', quantity: 2 },
      { title: 'no id', price_cents: 100 },
      { productId: 2, price_cents: 'free' },
    ])
    const cart = parseCart(raw)
    expect(cart).toHaveLength(1)
    expect(cart[0]).toMatchObject({ productId: 1, quantity: 2 })
  })

  it('drops a duplicate productId so a hand-edited blob cannot double a line', () => {
    const raw = JSON.stringify([
      { productId: 1, price_cents: 100, quantity: 1 },
      { productId: 1, price_cents: 100, quantity: 9 },
    ])
    expect(parseCart(raw)).toHaveLength(1)
  })
})

describe('readStoredCart and writeStoredCart', () => {
  it('round-trips through a storage object', () => {
    const store = memoryStorage()
    const cart = addLine([], mug, 2)

    expect(writeStoredCart(cart, store)).toBe(true)
    expect(readStoredCart(store)).toEqual(cart)
  })

  it('treats a missing or unusable store as an empty cart, never a throw', () => {
    expect(readStoredCart(null)).toEqual([])
    expect(
      readStoredCart({
        getItem() {
          throw new Error('storage disabled')
        },
        setItem() {},
      })
    ).toEqual([])
  })

  it('reports a refused write with false instead of throwing', () => {
    const full: CartStorage = {
      getItem: () => null,
      setItem() {
        throw new Error('QuotaExceededError')
      },
    }
    expect(writeStoredCart(addLine([], mug), full)).toBe(false)
    expect(writeStoredCart(addLine([], mug), null)).toBe(false)
  })
})
