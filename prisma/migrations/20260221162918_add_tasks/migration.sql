-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "zone" TEXT,
    "type" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "due" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "owner" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_farmId_idx" ON "Task"("farmId");

-- CreateIndex
CREATE INDEX "Task_farmId_due_idx" ON "Task"("farmId", "due");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
