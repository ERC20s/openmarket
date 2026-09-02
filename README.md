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
- GET /api/products/[id] returns the product with its seller summary.
- GET /api/sellers/[id]?page=1&size=20 returns JSON { seller, products, total, page, size } for the requested seller id.

API rules

- All three routes are GET-only. Any other method returns 405 with an `Allow: GET` header, and the method is checked before the id, so a POST to a malformed id is a 405 rather than a 422.
- Ids must be positive integers matching `^[1-9][0-9]*$` — for example `/api/products/42`. Values such as `9abc`, `9.7`, `9%20`, `0`, `-1` and `01` return 422 `{ "error": "Invalid id" }`; they are no longer coerced to a nearby number.
- `page` and `size` stay as before: page >= 1, 1 <= size <= 100, otherwise 422 `{ "error": "Invalid page or size" }`.
