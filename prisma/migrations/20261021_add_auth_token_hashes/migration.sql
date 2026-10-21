-- AlterTable
ALTER TABLE "Order" ADD COLUMN "buyerTokenHash" TEXT;

-- AlterTable
ALTER TABLE "Seller" ADD COLUMN "apiTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Seller_apiTokenHash_key" ON "Seller"("apiTokenHash");

