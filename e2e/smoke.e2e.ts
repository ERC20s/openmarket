import { expect, test } from '@playwright/test'

// One buyer's path through the storefront, against the seeded database:
// storefront -> faceted search (seller facet + text search) -> product page ->
// cart -> checkout review. It stops at the review: placing the order is covered
// by the API tests, and the smoke test must not depend on the rate limiter.

test('storefront to checkout', async ({ page }) => {
  // Storefront: the seeded catalogue loads.
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'openmarket' })).toBeVisible()
  await expect(page.getByText(/Showing 1–\d+ of \d+ products?\./)).toBeVisible()

  // Facet: pick the first seller in the picker.
  const picker = page.getByLabel('Filter by seller')
  const firstSeller = picker.locator('option').nth(1)
  const sellerId = await firstSeller.getAttribute('value')
  expect(sellerId).toMatch(/^\d+$/)
  await picker.selectOption(sellerId!)
  await expect(page).toHaveURL(new RegExp(`[?&]sellerId=${sellerId}(&|$)`))
  await expect(page.getByText(/Showing 1–\d+ of \d+ products?\./)).toBeVisible()

  // Search within that seller for a word from the first product's title.
  const firstTitle = (await page.locator('li strong a').first().innerText()).trim()
  const word = firstTitle.split(/\s+/).pop()!
  await page.getByLabel('Search products').fill(word)
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(page).toHaveURL(new RegExp(`[?&]q=${encodeURIComponent(word)}(&|$)`))
  await expect(page).toHaveURL(new RegExp(`[?&]sellerId=${sellerId}(&|$)`))
  await expect(page.getByText(/Showing 1–\d+ of \d+ products?\./)).toBeVisible()

  // Open the first result.
  const productLink = page.locator('li strong a').first()
  await expect(productLink).toBeVisible()
  const title = (await productLink.innerText()).trim()

  // Product page.
  await productLink.click()
  await expect(page).toHaveURL(/\/products\/\d+/)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()

  // Cart.
  await page.getByRole('button', { name: 'Add to cart' }).click()
  await expect(page.getByRole('status')).toContainText('Added.')
  await page.getByRole('link', { name: 'View cart' }).click()
  await expect(page).toHaveURL(/\/cart$/)
  await expect(page.getByRole('heading', { name: 'Your cart' })).toBeVisible()
  await expect(page.getByRole('link', { name: title })).toBeVisible()

  // Checkout review: priced by POST /api/checkout, no error banner.
  await page.getByRole('link', { name: 'Review and check out' }).click()
  await expect(page).toHaveURL(/\/checkout$/)
  await expect(page.getByRole('heading', { name: 'Review your order' })).toBeVisible()
  await expect(page.getByText('Total to pay')).toBeVisible()
  await expect(page.getByText(title)).toBeVisible()
  // Scoped to main: Next's route announcer is a role=alert outside it.
  await expect(page.locator('main').getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Place order/ })).toBeEnabled()
})
