-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Equipos',
    "purchaseValue" DOUBLE PRECISION NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usefulLifeYears" INTEGER NOT NULL DEFAULT 1,
    "residualValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Asset_farmId_idx" ON "Asset"("farmId");

-- CreateIndex
CREATE INDEX "Asset_farmId_purchaseDate_idx" ON "Asset"("farmId", "purchaseDate");

-- CreateIndex
CREATE INDEX "Asset_farmId_category_idx" ON "Asset"("farmId", "category");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
