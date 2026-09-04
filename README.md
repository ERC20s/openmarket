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
- The storefront at / fetches GET /api/products?page=1&size=20 in the browser and
  lists each product's title, price and seller. It shows a distinct line for
  loading, for a failed request and for an empty (unseeded) database.
- Prices are stored as whole cents (Product.price_cents) and rendered through
  formatPrice in lib/format.ts.

Testing

- Run tests: npm test
- The API tests need no database: they replace @prisma/client with the spies in
  tests/helpers/prisma-mock.ts, so npm install && npm test is green on a clean
  clone with no generate, migrate or seed, and prisma/dev.db is never written.
- tests/format.test.ts covers formatPrice (0, 5, 1234) so the storefront's money
  rendering is unit-tested without a DOM test runner.
- Each test sets what a spy resolves to and asserts the response plus the query
  arguments (skip, take, orderBy, select). Mocked tests do not prove SQL is
  valid, so a schema change still needs a real migrate.

API

- GET /api/products?page=1&size=20 returns JSON { items, total, page, size }. Ensure the DB is seeded first.
- GET /api/sellers/[id]?page=1&size=20 returns JSON { seller, products, total, page, size } for the requested seller id. The seller carries id and name only - the email column is never returned.
- Every API route is GET-only: any other method answers 405 with an Allow: GET header and JSON { error: 'Method not allowed' }.
- Every API route answers JSON, including failures: an unexpected exception is logged with console.error on the server and answered as 500 { error: 'Internal server error' }, never an HTML error page or a stack trace.
