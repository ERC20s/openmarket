# openmarket
A multi-seller marketplace - storefront, faceted search, seller pages, cart, checkout stub, order state machine.

Local development and DB

- Install dev dependencies: npm install
- Generate Prisma client: npm run prisma:generate
- Create migration and DB: npm run prisma:migrate
- Seed the DB: npm run prisma:seed

Running the site

- Start the dev server: npm run dev (Next.js on http://localhost:3000)
- Production build: npm run build, then npm start (also port 3000)
- The `web` entry in the root .d8a runs `npm run dev` on port 3000; that is the entry the
  public site is proxied to.

Pages

- / is the storefront. It server-renders the newest products with title, price and seller,
  and accepts ?page=1&size=20 (size capped at 100, same bound as the products API); values
  outside those bounds fall back to the defaults instead of erroring.

Testing

- Run tests: npm test

API

- GET /api/products?page=1&size=20 returns JSON { items, total, page, size }. Ensure the DB is seeded first.
- GET /api/sellers/[id]?page=1&size=20 returns JSON { seller, products, total, page, size } for the requested seller id.
