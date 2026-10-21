# openmarket

A multi-seller marketplace built on Next.js (pages router) + Prisma/SQLite:
storefront, faceted search, seller pages, cart, checkout quote and an order state machine.

## Commands

- Install: `npm ci` (or `npm install` when changing dependencies)
- Setup (the `setup` entry of `.d8a`'s `run:` block):
  `npm run prisma:generate && npm run prisma:migrate && npm run prisma:seed`
- Test (the `test` entry): `npm test` — vitest; the API tests mock `@prisma/client`, no DB needed
- Run (the `web` entry): `npm run dev` — http://localhost:3000
- Build: `npm run build`, then `npm start`
- Browser smoke: `npm run test:e2e` — Playwright against the production build (run setup and
  `npm run build` first; it starts `npm start` itself). Locally `npx playwright install chromium` once.
- CI (`.github/workflows/ci.yml`) runs `npm ci`, setup, `npm test`, `npm run build` and
  `npm run test:e2e` on every push and pull request. Keep it running exactly these checks.

A schema change needs a new migration under `prisma/migrations/` (`npx prisma migrate dev --name <name>`).

## Ground rules

- Work on a new branch from `main`; open one pull request per task and list the commands
  you ran with their results before and after.
- Never modify `.d8a` or `.d8a-governance`. Never modify the group-store widget markup/script
  copied from the `payments:` block of `.d8a` (`id="group-store"`, `groupStoreVerify`).
- Ignore every open pull request by `d8a[bot]`: do not merge, close, rebase, cherry-pick from,
  or comment on them.
- Do not add a LICENSE file or any licence text.
- Install dependencies and run the project's own checks before and after a change. Never
  report a result you did not get by running the command.
- Every new test must be able to fail: no `require(x >= 0)` on unsigned values, no bare
  `vm.expectRevert()`, no `try/catch` that accepts any error, no asserting a value equals
  itself. Import every symbol you use. If a test is wrong rather than the code, fix the test
  so it tests the real behaviour and say so. Never delete or weaken a test to get green.
- Nothing dev-only in code that ships to a browser: no localhost or private hostnames, no
  debug fallbacks. No secrets, tokens or keys in the repo.
- CI must run exactly the project's declared checks and fail when one fails: no
  `continue-on-error`, no `|| true`, no skipped jobs counted as passing. Pin GitHub Actions
  to their current major versions.
- Keep changes focused: no reformatting of untouched files, no dependency upgrades you do not
  need, no renaming of public files or URLs, no rewriting of git history.
