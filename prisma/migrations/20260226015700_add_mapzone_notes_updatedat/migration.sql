-- AlterTable
ALTER TABLE "MapZone" ADD COLUMN     "notesUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "MapZone_farmId_notesUpdatedAt_idx" ON "MapZone"("farmId", "notesUpdatedAt");
