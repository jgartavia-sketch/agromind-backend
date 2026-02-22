-- 1️⃣ Agregar la columna como nullable (ya lo hace así)
ALTER TABLE "Task" ADD COLUMN "start" TIMESTAMP(3);

-- 2️⃣ Backfill: si ya existen tareas, usar due como start
UPDATE "Task"
SET "start" = "due"
WHERE "start" IS NULL;

-- 3️⃣ Convertir la columna en obligatoria
ALTER TABLE "Task"
ALTER COLUMN "start" SET NOT NULL;

-- 4️⃣ Índice
CREATE INDEX "Task_farmId_start_idx" ON "Task"("farmId", "start");