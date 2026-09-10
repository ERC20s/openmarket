-- Migration: add compound index on Product(sellerId, createdAt)
-- This migration was generated for sqlite via `prisma migrate dev` in the approved proposal.

CREATE INDEX IF NOT EXISTS "Product_sellerId_createdAt_idx" ON "Product" ("sellerId", "createdAt");
