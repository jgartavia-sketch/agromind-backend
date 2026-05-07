import express from "express";
import jwt from "jsonwebtoken";

function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: "Sin token." });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ error: "Falta JWT_SECRET en el servidor." });
    }

    const payload = jwt.verify(token, secret);
    if (!payload?.sub) {
      return res.status(401).json({ error: "Token inválido." });
    }

    req.user = { id: payload.sub };
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado." });
  }
}

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
    completedAt === undefined ? fallbackCurrent : completedAt ? parseDateOrNull(completedAt) : null;

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

export default function processesRouter(prisma) {
  const router = express.Router();

  // =========================================================
  // GET /api/processes/zone/:zoneId
  // Lista procesos de una zona
  // =========================================================
  router.get("/zone/:zoneId", requireAuth, async (req, res) => {
    try {
      const { zoneId } = req.params;

      const zone = await prisma.mapZone.findFirst({
        where: {
          id: zoneId,
          farm: {
            userId: req.user.id,
          },
        },
        select: { id: true },
      });

      if (!zone) {
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

  // =========================================================
  // POST /api/processes
  // Crea un proceso
  // =========================================================
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

      const zone = await prisma.mapZone.findFirst({
        where: {
          id: zoneId,
          farm: {
            userId: req.user.id,
          },
        },
        select: { id: true },
      });

      if (!zone) {
        return res.status(404).json({ error: "Zona no encontrada." });
      }

      const parsedStartDate = parseDateOrNull(startDate);
      const parsedTargetDate = parseDateOrNull(targetDate);
      const parsedCompletedAt = parseDateOrNull(completedAt);

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
          startDate: parsedStartDate,
          targetDate: parsedTargetDate,
          completedAt: parsedCompletedAt,
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

  // =========================================================
  // PUT /api/processes/:id
  // Actualiza un proceso
  // =========================================================
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

      const existing = await prisma.zoneProcess.findFirst({
        where: {
          id,
          zone: {
            farm: {
              userId: req.user.id,
            },
          },
        },
        select: { id: true },
      });

      if (!existing) {
        return res.status(404).json({ error: "Proceso no encontrado." });
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
        ...(owner !== undefined
          ? { owner: cleanString(owner, 120) }
          : {}),
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

  // =========================================================
  // DELETE /api/processes/:id
  // Elimina un proceso
  // =========================================================
  router.delete("/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;

      const existing = await prisma.zoneProcess.findFirst({
        where: {
          id,
          zone: {
            farm: {
              userId: req.user.id,
            },
          },
        },
        select: { id: true },
      });

      if (!existing) {
        return res.status(404).json({ error: "Proceso no encontrado." });
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

  // =========================================================
  // POST /api/processes/step
  // Crea una etapa de un proceso
  // =========================================================
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

      const process = await prisma.zoneProcess.findFirst({
        where: {
          id: processId,
          zone: {
            farm: {
              userId: req.user.id,
            },
          },
        },
        include: {
          steps: {
            select: { stepOrder: true },
            orderBy: { stepOrder: "desc" },
            take: 1,
          },
        },
      });

      if (!process) {
        return res.status(404).json({ error: "Proceso no encontrado." });
      }

      const nextOrder =
        typeof stepOrder === "number" && Number.isFinite(stepOrder)
          ? stepOrder
          : (process.steps?.[0]?.stepOrder || 0) + 1;

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

  // =========================================================
  // PUT /api/processes/step/:id
  // Actualiza una etapa
  // =========================================================
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

      const existing = await prisma.zoneProcessStep.findFirst({
        where: {
          id,
          process: {
            zone: {
              farm: {
                userId: req.user.id,
              },
            },
          },
        },
        select: {
          id: true,
          status: true,
          completedAt: true,
        },
      });

      if (!existing) {
        return res.status(404).json({ error: "Etapa no encontrada." });
      }

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
        ...(owner !== undefined
          ? { owner: cleanString(owner, 120) }
          : {}),
        ...(notes !== undefined
          ? { notes: cleanString(notes, 1000) }
          : {}),
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

  // =========================================================
  // DELETE /api/processes/step/:id
  // Elimina una etapa
  // =========================================================
  router.delete("/step/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;

      const existing = await prisma.zoneProcessStep.findFirst({
        where: {
          id,
          process: {
            zone: {
              farm: {
                userId: req.user.id,
              },
            },
          },
        },
        select: { id: true },
      });

      if (!existing) {
        return res.status(404).json({ error: "Etapa no encontrada." });
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