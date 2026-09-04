# openmarket
A multi-seller marketplace - storefront, faceted search, seller pages, cart, checkout stub, order state machine.

Local development and DB

- Install dev dependencies: npm install
- Generate Prisma client: npm run prisma:generate
- Create migration and DB: npm run prisma:migrate
- Seed the DB: npm run prisma:seed

Testing

- Run tests: npm test
- The API tests need no database: they replace @prisma/client with the spies in
  tests/helpers/prisma-mock.ts, so npm install && npm test is green on a clean
  clone with no generate, migrate or seed, and prisma/dev.db is never written.
- Each test sets what a spy resolves to and asserts the response plus the query
  arguments (skip, take, orderBy, select). Mocked tests do not prove SQL is
  valid, so a schema change still needs a real migrate.

API

- GET /api/products?page=1&size=20 returns JSON { items, total, page, size }. Ensure the DB is seeded first.
- GET /api/sellers/[id]?page=1&size=20 returns JSON { seller, products, total, page, size } for the requested seller id. The seller carries id and name only - the email column is never returned.
- Every API route is GET-only: any other method answers 405 with an Allow: GET header and JSON { error: 'Method not allowed' }.
- Every API route answers JSON, including failures: an unexpected exception is logged with console.error on the server and answered as 500 { error: 'Internal server error' }, never an HTML error page or a stack trace.
