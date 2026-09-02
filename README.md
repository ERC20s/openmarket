# openmarket
A multi-seller marketplace - storefront, faceted search, seller pages, cart, checkout stub, order state machine.

Local development and DB

- Install dev dependencies: npm install
- Generate Prisma client: npm run prisma:generate
- Create migration and DB: npm run prisma:migrate
- Seed the DB: npm run prisma:seed

Testing

- Run tests once and exit: npm run test:run
- Watch mode while developing: npm test
- The tests need NO database. They do not require prisma:generate, prisma:migrate or
  prisma:seed, they never touch prisma/dev.db, and they can be run straight after
  npm install on a clean clone.
- How: each test file mocks '@prisma/client' with the in-memory client in
  tests/helpers/prisma-stub.ts (2 sellers, 25 products, fixed ids and createdAt
  values), so responses are asserted against exact fixture rows instead of whatever
  happens to be in a developer's database.
- Trade-off: because no SQL runs, the tests do not prove a Prisma query or the schema
  is valid. Changes to prisma/schema.prisma still need a real prisma:migrate run, and
  the stub in tests/helpers/prisma-stub.ts must be updated alongside the handlers when
  a new query shape is introduced (unsupported calls throw rather than return nothing).

API

- GET /api/products?page=1&size=20 returns JSON { items, total, page, size }. Ensure the DB is seeded first.
- GET /api/sellers/[id]?page=1&size=20 returns JSON { seller, products, total, page, size } for the requested seller id.
