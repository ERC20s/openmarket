# openmarket
A multi-seller marketplace - storefront, faceted search, seller pages, cart, checkout stub, order state machine.

Local development and DB

- Install dev dependencies: npm install
- Generate Prisma client: npm run prisma:generate
- Create migration and DB: npm run prisma:migrate
- Seed the DB: npm run prisma:seed

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
  loading, for a product that does not exist (the API's 404 or 422 answers show
  "Product not found", not the red error banner) and for a failed request.
- The detail link carries the current search, seller and page
  (/products/7?q=mug&sellerId=4&page=2), so "Back to results" returns to the
  same filtered page of the list; buildProductHref in lib/products-query.ts
  builds it and parseProductsQuery reads it back.
- Each seller name (on / and on a product page) links to that seller's page at
  /sellers/<id> (pages/sellers/[id].tsx), which fetches
  GET /api/sellers/<id>?page=&size= in the browser and shows the seller's name,
  their products with prices and Prev/Next paging. It has the same four states
  as the product page: loading, "Seller not found" for the API's 404 or 422, a
  failed request, and the list. buildSellerHref in lib/products-query.ts builds
  the link and carries only page and size (never q or sellerId); an id that is
  not a positive integer falls back to the storefront href, so a bad row can
  never produce a broken link.
- lib/products-query.ts is the single place that turns that state into the API
  URL (buildProductsQuery) and reads it back off next/router (parseProductsQuery).
  It clamps page >= 1, size to 1..100 and q to 100 characters — the same bounds
  pages/api/products.ts answers 422 on — so a hand-edited URL lands on the
  nearest legal page instead of the error banner.
- Prices are stored as whole cents (Product.price_cents) and rendered through
  formatPrice in lib/format.ts.

Testing

- Run tests: npm test
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
- tests/api-sellers.test.ts covers GET /api/sellers: the { sellers, total }
  shape with the product count flattened, the name ordering and 100-row cap,
  that the select carries no email, 405 with Allow: GET on a POST and JSON 500
  when the query rejects.
- Each test sets what a spy resolves to and asserts the response plus the query
  arguments (skip, take, orderBy, select). Mocked tests do not prove SQL is
  valid, so a schema change still needs a real migrate.

API

- GET /api/products?page=1&size=20 returns JSON { items, total, page, size }. Ensure the DB is seeded first.
- GET /api/products also accepts q (matched against title and description, up to 100 characters) and sellerId (a positive integer); out-of-range page, size, q or sellerId answers 422. The storefront at / drives exactly these params.
- GET /api/products/[id] returns one product as JSON with its seller as { id, name }; a non-numeric or non-positive id answers 422 { error: 'Invalid id' } and an unknown id answers 404 { error: 'Product not found' }. The detail page at /products/[id] drives exactly this route.
- GET /api/sellers returns JSON { sellers, total } with each seller as
  { id, name, productCount }, ordered by name and capped at 100 rows. As with
  /api/sellers/[id], the query selects id, name and the product count only - the
  email column is never returned. The seller picker on / drives this route.
- GET /api/sellers/[id]?page=1&size=20 returns JSON { seller, products, total, page, size } for the requested seller id. The seller carries id and name only - the email column is never returned. A non-numeric or non-positive id answers 422 { error: 'Invalid id' } and an unknown id answers 404 { error: 'Seller not found' }. The seller page at /sellers/[id] drives exactly this route.
- Every API route is GET-only: any other method answers 405 with an Allow: GET header and JSON { error: 'Method not allowed' }.
- Every API route answers JSON, including failures: an unexpected exception is logged with console.error on the server and answered as 500 { error: 'Internal server error' }, never an HTML error page or a stack trace.
