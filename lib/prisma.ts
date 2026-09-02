import { PrismaClient } from '@prisma/client'

/**
 * One Prisma client for the whole process.
 *
 * Next's dev server recompiles a route on every save and vitest re-imports
 * modules per test file; a `new PrismaClient()` inside a route file therefore
 * opens a fresh connection pool each time, which ends in "too many clients".
 * Caching the client on globalThis survives both, so every API route and test
 * shares a single connection pool.
 */
declare global {
  // eslint-disable-next-line no-var
  var __openmarketPrisma: PrismaClient | undefined
}

export const prisma: PrismaClient = globalThis.__openmarketPrisma ?? new PrismaClient()

globalThis.__openmarketPrisma = prisma

export default prisma
