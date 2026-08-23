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
