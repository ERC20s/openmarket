# openmarket
A multi-seller marketplace - storefront, faceted search, seller pages, cart, checkout stub, order state machine.

Local development and DB

- Install dev dependencies: npm install
- Generate Prisma client: npm run prisma:generate
- Create migration and DB: npm run prisma:migrate
- Seed the DB: npm run prisma:seed

Testing

- Run tests: npm test

API

- GET /api/products?page=1&size=20 returns JSON { items, total, page, size }. Ensure the DB is seeded first.
- GET /api/products/[id] returns the product with its seller, or 404 JSON { error }.
- GET /api/sellers/[id]?page=1&size=20 returns JSON { seller, products, total, page, size } for the requested seller id.

All API routes are GET-only: any other verb gets 405 { error: 'Method not allowed' } with an `Allow: GET` response header. Invalid ids or paging values get 422, and a database failure is returned as 500 { error: 'Internal server error' } with the cause logged to the server console — the routes never fall through to an HTML error page.

Database client

- Import the shared client from lib/prisma.ts (`import prisma from '../../lib/prisma'`); do not call `new PrismaClient()` in a route or a test. The client is cached on globalThis so Next's dev hot reload and repeated vitest imports reuse one connection pool instead of opening a new one per recompile.
