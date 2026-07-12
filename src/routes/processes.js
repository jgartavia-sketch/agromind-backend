// src/routes/processes.js
import express from "express";
import { requireAuth } from "./farms.base.js";
import {
  assertZoneMember,
  assertProcessMember,
} from "../services/farmAccess.js";

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function cleanString(v, max = 255) {
  if (!isNonEmptyString(v)) return null;
  return v.trim().slice(0, max);
}

function cleanStatus(v, fallback) {
  return isNonEmptyString(v) ? v.trim().slice(0, 40) : fallback;
}

function cleanPriority(v, fallback = "Media") {
  return isNonEmptyString(v) ? v.trim().slice(0, 30) : fallback;
}

function parseDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeStepCompletion(status, completedAt, fallbackCurrent = null) {
  const finalStatus = cleanStatus(status, "Pendiente");
  const parsedCompletedAt =
    completedAt === undefined
      ? fallbackCurrent
      : completedAt
      ? parseDateOrNull(completedAt)
      : null;

  if (finalStatus === "Completada") {
    return {
      status: finalStatus,
      completedAt: parsedCompletedAt || new Date(),
    };
  }

  return {
    status: finalStatus,
    completedAt: null,
  };
}

function isAdmin(access) {
  return access?.role === "ADMIN";
}

async function getStepAccess(prisma, stepId, userId) {
  const step = await prisma.zoneProcessStep.findUnique({
    where: { id: stepId },
    select: {
      id: true,
      processId: true,
      status: true,
      completedAt: true,
    },
  });

  if (!step) return null;

  const access = await assertProcessMember(prisma, step.processId, userId);
  if (!access) return null;

  return { step, access };
}

export default function processesRouter(prisma) {
  const router = express.Router();

  // GET /api/processes/zone/:zoneId
  // ADMIN y CONSULTANT pueden ver procesos.
  router.get("/zone/:zoneId", requireAuth, async (req, res) => {
    try {
      const { zoneId } = req.params;

      const access = await assertZoneMember(prisma, zoneId, req.user.id);

      if (!access) {
        return res.status(404).json({ error: "Zona no encontrada." });
      }

      const processes = await prisma.zoneProcess.findMany({
        where: { zoneId },
        include: {
          steps: {
            orderBy: { stepOrder: "asc" },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      return res.json(processes);
    } catch (error) {
      console.error("GET /api/processes/zone/:zoneId", error);
      return res.status(500).json({ error: "Error cargando procesos." });
    }
  });

  // POST /api/processes
  // Solo ADMIN puede crear procesos.
  router.post("/", requireAuth, async (req, res) => {
    try {
      const {
        zoneId,
        name,
        description = "",
        type = "General",
        status = "Borrador",
        priority = "Media",
        owner = null,
        isRecurring = false,
        startDate = null,
        targetDate = null,
        completedAt = null,
      } = req.body || {};

      if (!isNonEmptyString(zoneId) || !isNonEmptyString(name)) {
        return res.status(400).json({ error: "zoneId y name son obligatorios." });
      }

      const access = await assertZoneMember(prisma, zoneId, req.user.id);

      if (!access) {
        return res.status(404).json({ error: "Zona no encontrada." });
      }

      if (!isAdmin(access)) {
        return res.status(403).json({ error: "Solo un administrador puede crear procesos." });
      }

      const process = await prisma.zoneProcess.create({
        data: {
          zoneId,
          name: name.trim().slice(0, 120),
          description: cleanString(description, 500),
          type: cleanString(type, 60) || "General",
          status: cleanStatus(status, "Borrador"),
          priority: cleanPriority(priority, "Media"),
          owner: cleanString(owner, 120),
          isRecurring: Boolean(isRecurring),
          startDate: parseDateOrNull(startDate),
          targetDate: parseDateOrNull(targetDate),
          completedAt: parseDateOrNull(completedAt),
        },
        include: {
          steps: {
            orderBy: { stepOrder: "asc" },
          },
        },
      });

      return res.status(201).json(process);
    } catch (error) {
      console.error("POST /api/processes", error);
      return res.status(500).json({ error: "Error creando proceso." });
    }
  });

  // PUT /api/processes/:id
  // Solo ADMIN puede actualizar procesos.
  router.put("/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const {
        name,
        description,
        type,
        status,
        priority,
        owner,
        isRecurring,
        startDate,
        targetDate,
        completedAt,
      } = req.body || {};

      const access = await assertProcessMember(prisma, id, req.user.id);

      if (!access) {
        return res.status(404).json({ error: "Proceso no encontrado." });
      }

      if (!isAdmin(access)) {
        return res.status(403).json({ error: "Solo un administrador puede editar procesos." });
      }

      const data = {
        ...(name !== undefined
          ? {
              name: isNonEmptyString(name)
                ? name.trim().slice(0, 120)
                : "Proceso sin nombre",
            }
          : {}),
        ...(description !== undefined
          ? { description: cleanString(description, 500) }
          : {}),
        ...(type !== undefined
          ? { type: cleanString(type, 60) || "General" }
          : {}),
        ...(status !== undefined
          ? { status: cleanStatus(status, "Borrador") }
          : {}),
        ...(priority !== undefined
          ? { priority: cleanPriority(priority, "Media") }
          : {}),
        ...(owner !== undefined ? { owner: cleanString(owner, 120) } : {}),
        ...(isRecurring !== undefined
          ? { isRecurring: Boolean(isRecurring) }
          : {}),
        ...(startDate !== undefined
          ? { startDate: startDate ? parseDateOrNull(startDate) : null }
          : {}),
        ...(targetDate !== undefined
          ? { targetDate: targetDate ? parseDateOrNull(targetDate) : null }
          : {}),
        ...(completedAt !== undefined
          ? { completedAt: completedAt ? parseDateOrNull(completedAt) : null }
          : {}),
      };

      const updated = await prisma.zoneProcess.update({
        where: { id },
        data,
        include: {
          steps: {
            orderBy: { stepOrder: "asc" },
          },
        },
      });

      return res.json(updated);
    } catch (error) {
      console.error("PUT /api/processes/:id", error);
      return res.status(500).json({ error: "Error actualizando proceso." });
    }
  });

  // DELETE /api/processes/:id
  // Solo ADMIN puede eliminar procesos.
  router.delete("/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;

      const access = await assertProcessMember(prisma, id, req.user.id);

      if (!access) {
        return res.status(404).json({ error: "Proceso no encontrado." });
      }

      if (!isAdmin(access)) {
        return res.status(403).json({ error: "Solo un administrador puede eliminar procesos." });
      }

      await prisma.zoneProcess.delete({
        where: { id },
      });

      return res.json({ ok: true });
    } catch (error) {
      console.error("DELETE /api/processes/:id", error);
      return res.status(500).json({ error: "Error eliminando proceso." });
    }
  });

  // POST /api/processes/step
  // Solo ADMIN puede crear etapas.
  router.post("/step", requireAuth, async (req, res) => {
    try {
      const {
        processId,
        name,
        description = "",
        stepOrder,
        status = "Pendiente",
        priority = "Media",
        owner = null,
        notes = "",
        startDate = null,
        dueDate = null,
        completedAt = null,
      } = req.body || {};

      if (!isNonEmptyString(processId) || !isNonEmptyString(name)) {
        return res.status(400).json({ error: "processId y name son obligatorios." });
      }

      const access = await assertProcessMember(prisma, processId, req.user.id);

      if (!access) {
        return res.status(404).json({ error: "Proceso no encontrado." });
      }

      if (!isAdmin(access)) {
        return res.status(403).json({ error: "Solo un administrador puede crear etapas." });
      }

      const lastStep = await prisma.zoneProcessStep.findFirst({
        where: { processId },
        select: { stepOrder: true },
        orderBy: { stepOrder: "desc" },
      });

      const nextOrder =
        typeof stepOrder === "number" && Number.isFinite(stepOrder)
          ? stepOrder
          : (lastStep?.stepOrder || 0) + 1;

      const normalizedCompletion = normalizeStepCompletion(status, completedAt);

      const step = await prisma.zoneProcessStep.create({
        data: {
          processId,
          name: name.trim().slice(0, 120),
          description: cleanString(description, 500),
          stepOrder: nextOrder,
          status: normalizedCompletion.status,
          priority: cleanPriority(priority, "Media"),
          owner: cleanString(owner, 120),
          notes: cleanString(notes, 1000),
          startDate: parseDateOrNull(startDate),
          dueDate: parseDateOrNull(dueDate),
          completedAt: normalizedCompletion.completedAt,
        },
      });

      return res.status(201).json(step);
    } catch (error) {
      console.error("POST /api/processes/step", error);
      return res.status(500).json({ error: "Error creando etapa." });
    }
  });

  // PUT /api/processes/step/:id
  // Solo ADMIN puede actualizar etapas.
  router.put("/step/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const {
        name,
        description,
        stepOrder,
        status,
        priority,
        owner,
        notes,
        startDate,
        dueDate,
        completedAt,
      } = req.body || {};

      const result = await getStepAccess(prisma, id, req.user.id);

      if (!result) {
        return res.status(404).json({ error: "Etapa no encontrada." });
      }

      if (!isAdmin(result.access)) {
        return res.status(403).json({ error: "Solo un administrador puede editar etapas." });
      }

      const { step: existing } = result;

      const data = {
        ...(name !== undefined
          ? {
              name: isNonEmptyString(name)
                ? name.trim().slice(0, 120)
                : "Etapa sin nombre",
            }
          : {}),
        ...(description !== undefined
          ? { description: cleanString(description, 500) }
          : {}),
        ...(stepOrder !== undefined
          ? { stepOrder: Number(stepOrder) || 1 }
          : {}),
        ...(priority !== undefined
          ? { priority: cleanPriority(priority, "Media") }
          : {}),
        ...(owner !== undefined ? { owner: cleanString(owner, 120) } : {}),
        ...(notes !== undefined ? { notes: cleanString(notes, 1000) } : {}),
        ...(startDate !== undefined
          ? { startDate: startDate ? parseDateOrNull(startDate) : null }
          : {}),
        ...(dueDate !== undefined
          ? { dueDate: dueDate ? parseDateOrNull(dueDate) : null }
          : {}),
      };

      if (status !== undefined || completedAt !== undefined) {
        const normalizedCompletion = normalizeStepCompletion(
          status !== undefined ? status : existing.status,
          completedAt,
          existing.completedAt
        );

        data.status = normalizedCompletion.status;
        data.completedAt = normalizedCompletion.completedAt;
      }

      const updated = await prisma.zoneProcessStep.update({
        where: { id },
        data,
      });

      return res.json(updated);
    } catch (error) {
      console.error("PUT /api/processes/step/:id", error);
      return res.status(500).json({ error: "Error actualizando etapa." });
    }
  });

  // DELETE /api/processes/step/:id
  // Solo ADMIN puede eliminar etapas.
  router.delete("/step/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;

      const result = await getStepAccess(prisma, id, req.user.id);

      if (!result) {
        return res.status(404).json({ error: "Etapa no encontrada." });
      }

      if (!isAdmin(result.access)) {
        return res.status(403).json({ error: "Solo un administrador puede eliminar etapas." });
      }

      await prisma.zoneProcessStep.delete({
        where: { id },
      });

      return res.json({ ok: true });
    } catch (error) {
      console.error("DELETE /api/processes/step/:id", error);
      return res.status(500).json({ error: "Error eliminando etapa." });
    }
  });

  return router;
}
