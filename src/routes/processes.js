// src/routes/processes.js
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
        isRecurring = false,
        startDate = null,
        targetDate = null,
      } = req.body || {};

      if (!isNonEmptyString(zoneId) || !isNonEmptyString(name)) {
        return res
          .status(400)
          .json({ error: "zoneId y name son obligatorios." });
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

      const process = await prisma.zoneProcess.create({
        data: {
          zoneId,
          name: name.trim(),
          description: isNonEmptyString(description) ? description.trim() : null,
          type: isNonEmptyString(type) ? type.trim() : "General",
          status: isNonEmptyString(status) ? status.trim() : "Borrador",
          isRecurring: Boolean(isRecurring),
          startDate: startDate ? new Date(startDate) : null,
          targetDate: targetDate ? new Date(targetDate) : null,
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

      const updated = await prisma.zoneProcess.update({
        where: { id },
        data: {
          ...(name !== undefined
            ? { name: isNonEmptyString(name) ? name.trim() : "Proceso sin nombre" }
            : {}),
          ...(description !== undefined
            ? {
                description: isNonEmptyString(description)
                  ? description.trim()
                  : null,
              }
            : {}),
          ...(type !== undefined
            ? { type: isNonEmptyString(type) ? type.trim() : "General" }
            : {}),
          ...(status !== undefined
            ? { status: isNonEmptyString(status) ? status.trim() : "Borrador" }
            : {}),
          ...(isRecurring !== undefined
            ? { isRecurring: Boolean(isRecurring) }
            : {}),
          ...(startDate !== undefined
            ? { startDate: startDate ? new Date(startDate) : null }
            : {}),
          ...(targetDate !== undefined
            ? { targetDate: targetDate ? new Date(targetDate) : null }
            : {}),
          ...(completedAt !== undefined
            ? { completedAt: completedAt ? new Date(completedAt) : null }
            : {}),
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
        startDate = null,
        dueDate = null,
      } = req.body || {};

      if (!isNonEmptyString(processId) || !isNonEmptyString(name)) {
        return res
          .status(400)
          .json({ error: "processId y name son obligatorios." });
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
        typeof stepOrder === "number"
          ? stepOrder
          : (process.steps?.[0]?.stepOrder || 0) + 1;

      const step = await prisma.zoneProcessStep.create({
        data: {
          processId,
          name: name.trim(),
          description: isNonEmptyString(description) ? description.trim() : null,
          stepOrder: nextOrder,
          status: isNonEmptyString(status) ? status.trim() : "Pendiente",
          startDate: startDate ? new Date(startDate) : null,
          dueDate: dueDate ? new Date(dueDate) : null,
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
        select: { id: true },
      });

      if (!existing) {
        return res.status(404).json({ error: "Etapa no encontrada." });
      }

      const updated = await prisma.zoneProcessStep.update({
        where: { id },
        data: {
          ...(name !== undefined
            ? { name: isNonEmptyString(name) ? name.trim() : "Etapa sin nombre" }
            : {}),
          ...(description !== undefined
            ? {
                description: isNonEmptyString(description)
                  ? description.trim()
                  : null,
              }
            : {}),
          ...(stepOrder !== undefined
            ? { stepOrder: Number(stepOrder) || 1 }
            : {}),
          ...(status !== undefined
            ? { status: isNonEmptyString(status) ? status.trim() : "Pendiente" }
            : {}),
          ...(startDate !== undefined
            ? { startDate: startDate ? new Date(startDate) : null }
            : {}),
          ...(dueDate !== undefined
            ? { dueDate: dueDate ? new Date(dueDate) : null }
            : {}),
          ...(completedAt !== undefined
            ? { completedAt: completedAt ? new Date(completedAt) : null }
            : {}),
        },
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