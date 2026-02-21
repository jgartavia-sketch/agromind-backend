-- AlterTable
ALTER TABLE "Farm" ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FinanceMovement" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "concept" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceMovement_farmId_idx" ON "FinanceMovement"("farmId");

-- CreateIndex
CREATE INDEX "FinanceMovement_farmId_date_idx" ON "FinanceMovement"("farmId", "date");

-- CreateIndex
CREATE INDEX "FinanceMovement_farmId_type_idx" ON "FinanceMovement"("farmId", "type");

-- CreateIndex
CREATE INDEX "Farm_userId_isPrimary_idx" ON "Farm"("userId", "isPrimary");

-- AddForeignKey
ALTER TABLE "FinanceMovement" ADD CONSTRAINT "FinanceMovement_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
