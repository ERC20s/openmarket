import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

import { formatPrice } from '../lib/format'

// A price that moves while the product sits in the cart. The review page names
// the change and shows the new total; Place order must then succeed at that
// total. It used to post the cart's stale snapshot as the price claim, so
// POST /api/orders answered 409 on every click and the order could never be
// placed. The price is changed straight in the database — the same effect as
// the seller's PATCH /api/products/[id] — and put back afterwards.
//
// This places one real order per run. The order route allows 10 a minute per
// client, so the smoke suite stays well inside it.

const prisma = new PrismaClient()

test.afterAll(async () => {
  await prisma.$disconnect()
})

test('a product whose price moved after it was added can still be ordered', async ({ page }) => {
  const product = await prisma.product.findFirst({ orderBy: { id: 'asc' } })
  expect(product).not.toBeNull()
  const { id, title, price_cents: original } = product!
  const moved = original + 150

  // Add to cart at today's price.
  await page.goto(`/products/${id}`)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await page.getByRole('button', { name: 'Add to cart' }).click()
  await expect(page.getByRole('status')).toContainText('Added.')

  await prisma.product.update({ where: { id }, data: { price_cents: moved } })
  try {
    // Review: the move is named, the total is the new price.
    await page.goto('/checkout')
    const warning = page.locator('main').getByRole('alert')
    await expect(warning).toContainText(`The price of ${title} changed while it was in the cart.`)
    await expect(warning).toContainText(`${formatPrice(original)} → ${formatPrice(moved)}`)
    const button = page.getByRole('button', { name: `Place order — ${formatPrice(moved)}` })
    await expect(button).toBeEnabled()

    // Place it: no 409 banner, straight to the confirmation at the new total.
    await button.click()
    await expect(page).toHaveURL(/\/orders\/om_[0-9a-f]{24}$/)
    await expect(page.getByRole('heading', { name: 'Thank you — your order is placed' })).toBeVisible()
    await expect(page.getByText('Placed, not paid yet')).toBeVisible()
    await expect(page.getByText('Order total')).toBeVisible()
    await expect(page.locator('main')).toContainText(formatPrice(moved))
    await expect(page.locator('main').getByRole('alert')).toHaveCount(0)

    // The server wrote it at the price the review showed.
    const reference = page.url().split('/').pop()!
    const order = await prisma.order.findUnique({ where: { reference }, include: { items: true } })
    expect(order?.total_cents).toBe(moved)
    expect(order?.items.map((item) => [item.productId, item.price_cents])).toEqual([[id, moved]])

    // The cart was emptied on the way to the confirmation page.
    await page.goto('/cart')
    await expect(page.getByText('Your cart is empty.')).toBeVisible()
  } finally {
    await prisma.product.update({ where: { id }, data: { price_cents: original } })
  }
})
