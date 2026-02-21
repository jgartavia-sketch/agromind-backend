/*
  Warnings:

  - A unique constraint covering the columns `[userId,name]` on the table `Farm` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Farm_userId_name_key" ON "Farm"("userId", "name");

-- CreateIndex
CREATE INDEX "MapLine_farmId_updatedAt_idx" ON "MapLine"("farmId", "updatedAt");

-- CreateIndex
CREATE INDEX "MapPoint_farmId_updatedAt_idx" ON "MapPoint"("farmId", "updatedAt");

-- CreateIndex
CREATE INDEX "MapZone_farmId_updatedAt_idx" ON "MapZone"("farmId", "updatedAt");
