# openmarket
A multi-seller marketplace - storefront, faceted search, seller pages, cart, checkout stub, order state machine.

Local development and DB

- Install dev dependencies: npm install
- Generate Prisma client: npm run prisma:generate
- Create migration and DB: npm run prisma:migrate
- Seed the DB: npm run prisma:seed. The seed writes nothing when the database
  already holds sellers or products (prisma/seed-data.ts checks first), so the
  setup entry can be run again without doubling the catalogue; delete
  prisma/dev.db and run setup again for a fresh seed.
- The schema now carries Order and OrderItem as well as Seller and Product, so
  an existing clone must re-run npm run prisma:generate && npm run prisma:migrate
  once before placing an order.

Running

- Install dependencies: npm install
- Start the dev server: npm run dev — serves the storefront at http://localhost:3000
  and the API routes under http://localhost:3000/api.
- Production build: npm run build, then npm start (also port 3000).
- The storefront at / fetches GET /api/products in the browser and lists each
  product's title, price and seller. It shows a distinct line for loading, for a
  failed request, for an empty (unseeded) database and for a search that matches
  nothing.
- Search, seller filter and paging live in the page URL: /?q=mug, /?sellerId=4,
  /?page=2 (and /?size=50). The search form and the Prev/Next links write those
  params, a seller name links to /?sellerId=<id> rather than the raw API route,
  and the page re-fetches only when the URL changes — never on a keystroke.
- The seller facet on / is a "Seller" picker fed by GET /api/sellers (fetched
  once per page load, not per search). "All sellers" clears the filter and any
  other option pushes /?sellerId=<id> at page 1, keeping the current search and
  size. If that fetch fails the picker is simply hidden — search, paging and a
  hand-typed ?sellerId= keep working. The filter banner shows the seller's name
  when the list loaded (and "Seller #<id>" when it did not), linking to that
  seller's page either way.
- Each product title on / links to its detail page at /products/<id>
  (pages/products/[id].tsx), which fetches GET /api/products/<id> in the browser
  and shows the title, price, description and seller. It has its own line for
  loading, for a product that does not exist (the API's 404 or 400 answers show
  "Product not found", not the red error banner) and for a failed request.
- The detail link carries the current search, seller and page
  (/products/7?q=mug&sellerId=4&page=2), so "Back to results" returns to the
  same filtered page of the list; buildProductHref in lib/products-query.ts
  builds it and parseProductsQuery reads it back.
- Each seller name (on / and on a product page) links to that seller's page at
  /sellers/<id> (pages/sellers/[id].tsx), which fetches
  GET /api/sellers/<id>?page=&size= in the browser and shows the seller's name,
  their products with prices and Prev/Next paging. It has the same four states
  as the product page: loading, "Seller not found" for the API's 404 or 400, a
  failed request, and the list. buildSellerHref in lib/products-query.ts builds
  the link and carries only page and size (never q or sellerId); an id that is
  not a positive integer falls back to the storefront href, so a bad row can
  never produce a broken link.
- A "View orders" link on the seller page opens /sellers/[id]/orders
  (pages/sellers/[id]/orders.tsx), which fetches
  GET /api/sellers/[id]/orders?page=&size= and lists that seller's own orders:
  status (via describeStatus from lib/orders.ts), when it was placed, this
  seller's lines and their subtotal. It never shows the order reference or
  another seller's lines from a shared order - this page is public and
  indexed by seller id, unlike the buyer confirmation page a reference is
  handed to once. Same four states and the same Prev/Next paging as the
  seller page.
- Add to cart on a product page (pages/products/[id].tsx) writes the product
  into a cart kept in this browser's localStorage under openmarket.cart.v1. A
  repeat click bumps the quantity on the same line instead of adding a second
  one, and the button says so; if storage is full or disabled the page says that
  too, rather than throwing.
- The cart page at /cart (pages/cart.tsx) lists the saved lines grouped by
  seller, with a subtotal per seller, a quantity box and Remove per line, a
  grand total and an "Empty the cart" control. An empty cart links back to the
  storefront, and a filled one carries a "Review and check out" link to
  /checkout. The storefront header carries a
  "Cart (n)" link, and both pages only read storage inside an effect, so the
  first render always matches the server markup (no hydration mismatch).
- lib/cart.ts holds the cart logic as pure functions over an array of lines
  (addLine, setQuantity — 0 removes, removeLine, clearCart, cartCount,
  cartSubtotal, groupBySeller, parseCart/serializeCart), plus the two storage
  helpers readStoredCart/writeStoredCart, which take an optional Storage-like
  object (the tests pass one) and default to window.localStorage. Quantities are
  clamped to 1..99, exactly as normalizeProductsQuery clamps size to 1..100, a
  malformed line from storage is dropped rather than rendered, and neither
  helper ever throws — a refused write returns false. A cart line is a snapshot
  of the product at the moment it was added, so it renders with the API down,
  and a price that changes on the server stays stale until a checkout re-reads
  it from GET /api/products/<id>.
- The checkout review page at /checkout (pages/checkout.tsx) reads the saved
  cart, posts it to POST /api/checkout and renders only what the server sends
  back: lines grouped by seller with subtotals, a grand total and, when the
  cart disagreed with the marketplace, a warning list naming every product
  whose price moved or that is no longer for sale. It has its own line for
  loading, for an empty cart and for a failed request. Its "Place order" button
  posts the lines as the review priced them (orderRequestFromQuote in
  lib/quote.ts: the quoted products at the quoted prices, a delisted one left
  out) to POST /api/orders, so a price that moved while the product sat in the
  cart is ordered at the price the buyer just saw rather than refused on every
  click: on success it empties the cart and goes to /orders/<reference>; on 409
  (a price moved or a product was delisted since the review) it writes nothing,
  shows the reason and re-prices the cart so the warning list names what changed.
- The confirmation page at /orders/<reference> (pages/orders/[id].tsx) fetches
  GET /api/orders/<reference> and shows the reference, the status, the bought
  lines grouped by seller with subtotals and the order total. It has the same
  four states as the other detail pages: loading, "Order not found" for the
  API's 404 or 400, a failed request, and the order. It reads nothing from the
  cart — the order lives on the server.
- lib/orders.ts is the order state machine as pure functions: ORDER_STATUSES
  (pending, paid, shipped, delivered, cancelled), canTransition, applyTransition
  (which gives back either the new status or the reason it was refused),
  nextStatuses, isTerminal, describeStatus, plus newOrderReference /
  isOrderReference for the public "om_" + 24 hex reference. pending may go to
  paid or cancelled, paid to shipped or cancelled, shipped to delivered; nothing
  moves once it is delivered or cancelled.
- lib/quote.ts holds the cart pricing that /api/checkout and /api/orders share
  (readBody, normalizeRequestedLines, requestedIds, priceQuote,
  groupLinesBySeller). It is pure — the route does the database read and hands
  the rows in — so the order is written at exactly the total the review page
  quoted.
- lib/products-query.ts is the single place that turns that state into the API
  URL (buildProductsQuery) and reads it back off next/router (parseProductsQuery).
  It clamps page to 1..10000, size to 1..100 and q to 100 characters — the same bounds
  pages/api/products.ts answers 400 on — so a hand-edited URL lands on the
  nearest legal page instead of the error banner.
- Prices are stored as whole cents (Product.price_cents) and rendered through
  formatPrice in lib/format.ts.

Testing

- Run tests: npm test
- Browser smoke test: npm run test:e2e (Playwright, after setup and npm run build;
  it starts npm start itself). e2e/smoke.e2e.ts walks storefront -> seller facet
  and search -> product -> cart -> checkout review. e2e/checkout-reprice.e2e.ts
  adds a product to the cart, moves its price in the database, checks the
  review names the change and places the order at the new total (one real
  order per run; the price is put back afterwards). CI runs both after the build.
- tests/seed.test.ts covers prisma/seed-data.ts against a spy client: an empty
  database gets 10 sellers and 500 products spread evenly, and a database that
  already holds rows in either table gets nothing written.
- tests/api-auth.test.ts covers the authorisation rules: a seller creating,
  editing and delisting only their own products and renaming only their own
  storefront (another seller gets 403, no token 401), and a buyer cancelling
  only an order placed with their own cookie.
- tests/validation.test.ts sends junk paths, queries and bodies to every route
  and checks each answers 400 without a database call; tests/rate-limit.test.ts
  covers the limiter's LRU bound, TTL expiry and client keying (a spoofed
  X-Forwarded-For with and without TRUSTED_PROXY).
- The API tests need no database: they replace @prisma/client with the spies in
  tests/helpers/prisma-mock.ts, so npm install && npm test is green on a clean
  clone with no generate, migrate or seed, and prisma/dev.db is never written.
- tests/format.test.ts covers formatPrice (0, 5, 1234) so the storefront's money
  rendering is unit-tested without a DOM test runner.
- tests/products-query.test.ts covers lib/products-query.ts (trimming, clamping,
  encoding, seller filter, page links, the /products/<id> detail links and the
  /sellers/<id> seller links including the bad-id fallback). There
  is no DOM test runner here, so the storefront and detail pages themselves are
  only covered through that helper — check them by hand with npm run dev.
- tests/cart.test.ts covers lib/cart.ts: merging a repeat add, clamping to
  1..99, setting a quantity to 0 to remove, per-seller grouping and subtotals,
  the JSON round trip and rejecting junk from storage, and the storage helpers
  against an in-memory Storage stand-in (including a quota error answering
  false). It needs no DOM and no database.
- tests/api-sellers.test.ts covers GET /api/sellers: the { sellers, total }
  shape with the product count flattened, the name ordering and 100-row cap,
  that the select carries no email, 405 with Allow: GET on a POST and JSON 500
  when the query rejects.
- tests/api-checkout.test.ts covers POST /api/checkout: pricing from the
  database rather than from the body, per-seller grouping and the cents total,
  the price_changed and product_missing problems, quantity clamping and the
  merge of a repeated product, a raw JSON string body, 400 for fourteen shapes of
  junk (including more than 50 lines), 405 with Allow: POST on a GET and JSON
  500 when the query rejects.
- tests/orders.test.ts covers lib/orders.ts (the allowed transitions, the
  refusals with their messages, the terminal statuses, the reference format and
  its rejection of a bare row id) and lib/quote.ts (body reading, quantity
  clamping of a merged line, the 400 reasons, pricing from the rows rather than the
  claim, and per-seller grouping). tests/quote.test.ts also covers
  orderRequestFromQuote: the body the review page posts carries the quoted
  prices and leaves a delisted product out, so re-pricing it finds no problem
  while re-posting the stale snapshot still would. Neither needs a DOM or a database.
- tests/api-orders.test.ts covers POST /api/orders (the written order and its
  item snapshots, 409 with nothing written when a price moved or a product
  vanished, the id-only query with no email, a raw JSON string body, seven
  shapes of 400, 400 with nothing written for a total past Order.total_cents
  while one that fits is still written, 405 with Allow: POST and JSON 500 when the write rejects) and
  GET /api/orders/[id] (lookup by reference with per-seller grouping, 400 for a
  row id or a malformed reference, 404 for an unknown one, 405 with Allow: GET
  and JSON 500).
- tests/api-sellers-orders.test.ts covers GET /api/sellers/[id]/orders: grouping
  a seller's OrderItem rows back into orders with a per-order subtotal, newest
  order first, that the response never carries the reference or another
  seller's lines, an empty result for a seller with no orders (no second query
  fired), order-level pagination, 404 for an unknown seller, 400 for a bad id
  or page, and 405 with Allow: GET on a POST.
- Each test sets what a spy resolves to and asserts the response plus the query
  arguments (skip, take, orderBy, select). Mocked tests do not prove SQL is
  valid, so a schema change still needs a real migrate.

API

- GET /api/products?page=1&size=20 returns JSON { items, total, page, size }. Ensure the DB is seeded first.
- GET /api/products also accepts q (matched against title and description, up to 100 characters) and sellerId (a positive integer); page must be 1..10000, size 1..100, q at most 100 characters and sellerId a positive integer; anything else answers 400. The storefront at / drives exactly these params.
- GET /api/products/[id] returns one product as JSON with its seller as { id, name }; a non-numeric or non-positive id answers 400 { error: 'Invalid id' } and an unknown id answers 404 { error: 'Product not found' }. The detail page at /products/[id] drives exactly this route.
- GET /api/sellers returns JSON { sellers, total } with each seller as
  { id, name, productCount }, ordered by name and capped at 100 rows. As with
  /api/sellers/[id], the query selects id, name and the product count only - the
  email column is never returned. The seller picker on / drives this route.
- GET /api/sellers/[id]?page=1&size=20 returns JSON { seller, products, total, page, size } for the requested seller id. The seller carries id and name only - the email column is never returned. A non-numeric or non-positive id answers 400 { error: 'Invalid id' } and an unknown id answers 404 { error: 'Seller not found' }. The seller page at /sellers/[id] drives exactly this route.
- GET /api/sellers/[id]/orders?page=1&size=20 returns JSON { seller, orders, total, page, size } for that seller: each order is { status, createdAt, lines, subtotal } built from that seller's own OrderItem rows (sellerId/sellerName are snapshotted on every line at order time, so no schema change was needed). Orders are grouped and paginated at the order level, newest first, and the response never carries the order reference or another seller's lines from the same order - the same 400/404 rules as /api/sellers/[id] apply to the id, and the 405/500 rules above apply to method and errors. The "View orders" link on /sellers/[id] and the page at /sellers/[id]/orders drive exactly this route.
- POST /api/checkout takes { lines: [{ productId, quantity, price_cents? }] }
  and returns a quote priced from the database:
  { lines, sellers, total, count, problems, limits }. Each line carries the
  stored title, price_cents, quantity, line_total and seller; sellers is the
  same lines grouped with a subtotal each; total and every amount are whole
  cents. The client's price_cents is only a claim - it is never charged, and a
  line whose stored price differs comes back in problems as
  { code: 'price_changed', productId, was, now }; a product that no longer
  exists comes back as { code: 'product_missing', productId } and is left out
  of the total. A repeated productId is merged and the merged quantity is
  clamped to 99. A body that is not an array of lines, an empty cart, more than
  50 lines, a productId that is not a positive integer, a quantity outside
  1..99 or a price_cents claim that is not a whole number of cents answers 400. A cart whose
  total would not fit Order.total_cents (above 2,147,483,647 cents,
  MAX_ORDER_TOTAL_CENTS in lib/orders.ts) answers 400 { error: 'Order total too large' }
  here and from POST /api/orders, before any write. Nothing is persisted and no payment is taken by this
  route: it only quotes.
- POST /api/orders takes the same { lines: [...] } body, prices it again through
  lib/quote.ts and writes the order. It answers 201
  { reference, status, total, count, lines, sellers, createdAt } with status
  "pending". If the re-pricing turns up any problem - a price_changed or a
  product_missing - it answers 409 with those problems and the fresh quote and
  writes nothing, so the buyer re-reviews instead of being charged a total they
  never saw. The same 400 rules as /api/checkout apply to a malformed body.
  Order and OrderItem rows snapshot the title, price, quantity, line total and
  seller name, so an order still reads correctly after a product is renamed,
  re-priced or delisted. No payment is taken: the order sits at pending.
  The response sets an HttpOnly om_buyer cookie (reusing the one the browser
  already holds) and the order stores only its SHA-256: that cookie is what
  lets the buyer change the order later.
  It is rate limited to 10 orders per client per minute (429 with Retry-After).
  The client is the socket address; X-Forwarded-For is ignored unless
  TRUSTED_PROXY names the proxy the request came from (a comma-separated list
  of addresses), and then only the hop that proxy appended is used, never the
  first entry. Counts live in a bounded LRU (10,000 clients, entries expire
  with their window) in each server process.
- GET /api/orders/[reference] returns one order as
  { reference, status, total, count, createdAt, lines, sellers }. Orders are
  looked up by their public reference ("om_" + 24 hex) and never by row id, so
  nobody can walk /api/orders/1, /api/orders/2 through other people's orders; a
  reference of any other shape answers 400 { error: 'Invalid reference' } and an
  unknown one answers 404 { error: 'Order not found' }. The order carries no
  buyer contact detail, so there is nothing on it to leak. The confirmation page
  at /orders/[id] drives exactly this route.
- PATCH /api/orders/[reference] with { status: 'cancelled' } cancels a pending
  order. It needs the om_buyer cookie the order was placed with: none answers
  401, another buyer's answers 403 (knowing the reference is not enough), an
  unknown status answers 400 and a move the state machine refuses answers 409.
- Sellers change their own catalogue and storefront with an API token sent as
  Authorization: Bearer <token>. `npm run seller:token -- <sellerId>` issues
  (or rotates) one and prints it once; only its SHA-256 is stored. No token
  answers 401 and another seller's row answers 403:
  - POST /api/products { title, description?, price_cents } creates a product
    for the token's seller (a sellerId in the body is refused, never trusted);
  - PATCH /api/products/[id] { title?, description?, price_cents? } and
    DELETE /api/products/[id] edit or delist the seller's own product;
  - PATCH /api/sellers/[id] { name } renames the seller's own storefront.
  Bodies are strict: an unknown field (email, sellerId, ...) answers 400.
- The cart has no server side to protect: it lives in the buyer's own
  localStorage, and POST /api/checkout only quotes it.
- Every route validates its path, query and body with zod (lib/validation.ts)
  before touching the database, and answers 400 { error } for bad input.
- Each route answers 405 with an Allow header naming the methods it supports
  and JSON { error: 'Method not allowed' } for any other method.
- Every API route answers JSON, including failures: an unexpected exception is logged with console.error on the server and answered as 500 { error: 'Internal server error' }, never an HTML error page or a stack trace.
