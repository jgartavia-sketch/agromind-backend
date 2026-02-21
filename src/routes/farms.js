// src/routes/farms.js
import express from "express";
import jwt from "jsonwebtoken";

function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Sin token." });

    const secret = process.env.JWT_SECRET;
    if (!secret)
      return res
        .status(500)
        .json({ error: "Falta JWT_SECRET en el servidor." });

    const payload = jwt.verify(token, secret);
    if (!payload?.sub) return res.status(401).json({ error: "Token inválido." });

    req.user = { id: payload.sub };
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado." });
  }
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function cleanName(v, fallback) {
  const s = isNonEmptyString(v) ? v.trim() : "";
  return s.length ? s.slice(0, 80) : fallback;
}

function looksLikeId(v) {
  return isNonEmptyString(v) && v.trim().length >= 8;
}

function parseISODateOnlyToUTC(dateStr) {
  // dateStr esperado: "YYYY-MM-DD"
  // Guardamos como Date UTC para evitar líos de zona horaria
  if (!isNonEmptyString(dateStr)) return null;
  const s = dateStr.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0)); // mediodía UTC (más estable)
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function parseDateAnyToUTC(value) {
  // Acepta "YYYY-MM-DD" o ISO string o Date
  if (!value) return null;

  if (typeof value === "string") {
    const s = value.trim();
    const only = parseISODateOnlyToUTC(s);
    if (only) return only;

    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  // por si llega número timestamp
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseAmount(v) {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string"
      ? Number(v.replaceAll(",", "").trim())
      : NaN;

  if (Number.isNaN(n)) return null;
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return n;
}

function normalizeType(v) {
  const s = isNonEmptyString(v) ? v.trim() : "";
  if (s === "Ingreso") return "Ingreso";
  if (s === "Gasto") return "Gasto";
  return null;
}

export default function farmsRouter(prisma) {
  const router = express.Router();

  async function assertFarmOwner(farmId, userId) {
    return prisma.farm.findFirst({
      where: { id: farmId, userId },
      select: { id: true, name: true, view: true, preferredCenter: true },
    });
  }

  async function assertZoneOwner(zoneId, farmId) {
    return prisma.mapZone.findFirst({
      where: { id: zoneId, farmId },
      select: { id: true },
    });
  }

  // =========================
  // GET /api/farms
  // =========================
  router.get("/farms", requireAuth, async (req, res) => {
    try {
      const userId = req.user.id;

      const farms = await prisma.farm.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          view: true,
          preferredCenter: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.json({ farms });
    } catch (err) {
      console.error("GET_FARMS_ERROR:", err);
      return res.status(500).json({ error: "Error interno listando fincas." });
    }
  });

  // =========================
  // POST /api/farms
  // =========================
  router.post("/farms", requireAuth, async (req, res) => {
    try {
      const userId = req.user.id;
      const { name, view } = req.body || {};

      // ✅ Producción real: finca por defecto "Mi finca"
      const finalName = cleanName(name, "Mi finca");

      // Si el frontend no manda view, se guarda null (no inventamos demo)
      const finalView = view ?? null;

      const preferredCenter =
        finalView && Array.isArray(finalView.center) ? finalView.center : null;

      const farm = await prisma.farm.create({
        data: {
          userId,
          name: finalName,
          ...(finalView ? { view: finalView } : {}),
          ...(preferredCenter ? { preferredCenter } : {}),
        },
        select: {
          id: true,
          name: true,
          view: true,
          preferredCenter: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.status(201).json({ farm });
    } catch (err) {
      if (err?.code === "P2002") {
        return res
          .status(409)
          .json({ error: "Ya existe una finca con ese nombre." });
      }
      console.error("CREATE_FARM_ERROR:", err);
      return res.status(500).json({ error: "Error interno creando finca." });
    }
  });

  // =========================
  // GET /api/farms/:id/map
  // =========================
  router.get("/farms/:id/map", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const userId = req.user.id;

      if (!looksLikeId(farmId))
        return res.status(400).json({ error: "farmId inválido." });

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const [points, lines, zones] = await Promise.all([
        prisma.mapPoint.findMany({
          where: { farmId },
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true, data: true, createdAt: true, updatedAt: true },
        }),
        prisma.mapLine.findMany({
          where: { farmId },
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true, data: true, createdAt: true, updatedAt: true },
        }),
        prisma.mapZone.findMany({
          where: { farmId },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            data: true,
            components: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      ]);

      return res.json({ farm, points, lines, zones });
    } catch (err) {
      console.error("GET_MAP_ERROR:", err);
      return res.status(500).json({ error: "Error interno cargando mapa." });
    }
  });

  // =========================
  // PUT /api/farms/:id/map
  // body: { view, points, lines, zones }
  // =========================
  router.put("/farms/:id/map", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const userId = req.user.id;

      if (!looksLikeId(farmId))
        return res.status(400).json({ error: "farmId inválido." });

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const { view, points, lines, zones } = req.body || {};

      const safePoints = Array.isArray(points) ? points : [];
      const safeLines = Array.isArray(lines) ? lines : [];
      const safeZones = Array.isArray(zones) ? zones : [];

      const result = await prisma.$transaction(async (tx) => {
        if (view) {
          const preferredCenter =
            view && Array.isArray(view.center) ? view.center : null;

          await tx.farm.update({
            where: { id: farmId },
            data: {
              view,
              ...(preferredCenter ? { preferredCenter } : {}),
            },
          });
        }

        await tx.mapPoint.deleteMany({ where: { farmId } });
        await tx.mapLine.deleteMany({ where: { farmId } });
        await tx.mapZone.deleteMany({ where: { farmId } });

        if (safePoints.length > 0) {
          await tx.mapPoint.createMany({
            data: safePoints.map((p) => ({
              farmId,
              name: cleanName(p?.name, "Punto"),
              data: p?.data ?? p,
            })),
          });
        }

        if (safeLines.length > 0) {
          await tx.mapLine.createMany({
            data: safeLines.map((l) => ({
              farmId,
              name: cleanName(l?.name, "Línea"),
              data: l?.data ?? l,
            })),
          });
        }

        if (safeZones.length > 0) {
          for (const z of safeZones) {
            await tx.mapZone.create({
              data: {
                farmId,
                name: cleanName(z?.name, "Zona"),
                data: z?.data ?? z,
                components: z?.components ?? {},
              },
            });
          }
        }

        return {
          ok: true,
          saved: {
            points: safePoints.length,
            lines: safeLines.length,
            zones: safeZones.length,
          },
        };
      });

      return res.json(result);
    } catch (err) {
      console.error("PUT_MAP_ERROR:", err);
      return res.status(500).json({ error: "Error interno guardando mapa." });
    }
  });

  // =========================
  // PUT /api/farms/:farmId/zones/:zoneId/components
  // =========================
  router.put(
    "/farms/:farmId/zones/:zoneId/components",
    requireAuth,
    async (req, res) => {
      try {
        const { farmId, zoneId } = req.params;
        const userId = req.user.id;
        const { components } = req.body || {};

        if (!looksLikeId(farmId) || !looksLikeId(zoneId)) {
          return res.status(400).json({ error: "IDs inválidos." });
        }

        if (components === undefined) {
          return res.status(400).json({ error: "components es requerido." });
        }

        const farm = await assertFarmOwner(farmId, userId);
        if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

        const zone = await assertZoneOwner(zoneId, farmId);
        if (!zone) return res.status(404).json({ error: "Zona no encontrada." });

        const updatedZone = await prisma.mapZone.update({
          where: { id: zoneId },
          data: { components },
          select: { id: true, name: true, components: true, updatedAt: true },
        });

        return res.json({ ok: true, zone: updatedZone });
      } catch (err) {
        console.error("UPDATE_COMPONENTS_ERROR:", err);
        return res.status(500).json({ error: "Error guardando componentes." });
      }
    }
  );

  // ==========================================================
  // ✅ TAREAS (asociadas a finca)
  // ==========================================================

  // GET /api/farms/:id/tasks
  router.get("/farms/:id/tasks", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const userId = req.user.id;

      if (!looksLikeId(farmId))
        return res.status(400).json({ error: "farmId inválido." });

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const tasks = await prisma.task.findMany({
        where: { farmId },
        orderBy: [{ due: "asc" }, { createdAt: "desc" }],
        select: {
          id: true,
          farmId: true,
          title: true,
          zone: true,
          type: true,
          priority: true,
          due: true,
          status: true,
          owner: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.json({ tasks });
    } catch (err) {
      console.error("GET_TASKS_ERROR:", err);
      return res.status(500).json({ error: "Error interno listando tareas." });
    }
  });

  // POST /api/farms/:id/tasks
  router.post("/farms/:id/tasks", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const userId = req.user.id;

      if (!looksLikeId(farmId))
        return res.status(400).json({ error: "farmId inválido." });

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const { title, zone, type, priority, due, status, owner } = req.body || {};

      const finalTitle = cleanName(title, "");
      if (!finalTitle) {
        return res.status(400).json({ error: "title es requerido." });
      }

      const finalType = cleanName(type, "Mantenimiento");
      const finalPriority = cleanName(priority, "Media");
      const finalStatus = cleanName(status, "Pendiente");
      const finalZone = isNonEmptyString(zone) ? zone.trim().slice(0, 120) : null;
      const finalOwner = isNonEmptyString(owner) ? owner.trim().slice(0, 80) : null;

      const dueDate = parseISODateOnlyToUTC(due);
      if (!dueDate) {
        return res.status(400).json({ error: "due debe ser YYYY-MM-DD." });
      }

      const task = await prisma.task.create({
        data: {
          farmId,
          title: finalTitle,
          zone: finalZone,
          type: finalType,
          priority: finalPriority,
          due: dueDate,
          status: finalStatus,
          owner: finalOwner,
        },
        select: {
          id: true,
          farmId: true,
          title: true,
          zone: true,
          type: true,
          priority: true,
          due: true,
          status: true,
          owner: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.status(201).json({ task });
    } catch (err) {
      console.error("CREATE_TASK_ERROR:", err);
      return res.status(500).json({ error: "Error interno creando tarea." });
    }
  });

  // PUT /api/farms/:id/tasks/:taskId
  router.put("/farms/:id/tasks/:taskId", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const taskId = req.params.taskId;
      const userId = req.user.id;

      if (!looksLikeId(farmId) || !looksLikeId(taskId)) {
        return res.status(400).json({ error: "IDs inválidos." });
      }

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const existing = await prisma.task.findFirst({
        where: { id: taskId, farmId },
        select: { id: true },
      });
      if (!existing) return res.status(404).json({ error: "Tarea no encontrada." });

      const { title, zone, type, priority, due, status, owner } = req.body || {};

      const data = {};

      if (title !== undefined) {
        const finalTitle = cleanName(title, "");
        if (!finalTitle) return res.status(400).json({ error: "title inválido." });
        data.title = finalTitle;
      }

      if (zone !== undefined) {
        data.zone = isNonEmptyString(zone) ? zone.trim().slice(0, 120) : null;
      }

      if (type !== undefined) data.type = cleanName(type, "Mantenimiento");
      if (priority !== undefined) data.priority = cleanName(priority, "Media");
      if (status !== undefined) data.status = cleanName(status, "Pendiente");

      if (owner !== undefined) {
        data.owner = isNonEmptyString(owner) ? owner.trim().slice(0, 80) : null;
      }

      if (due !== undefined) {
        const dueDate = parseISODateOnlyToUTC(due);
        if (!dueDate) return res.status(400).json({ error: "due debe ser YYYY-MM-DD." });
        data.due = dueDate;
      }

      const task = await prisma.task.update({
        where: { id: taskId },
        data,
        select: {
          id: true,
          farmId: true,
          title: true,
          zone: true,
          type: true,
          priority: true,
          due: true,
          status: true,
          owner: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.json({ ok: true, task });
    } catch (err) {
      console.error("UPDATE_TASK_ERROR:", err);
      return res.status(500).json({ error: "Error interno actualizando tarea." });
    }
  });

  // DELETE /api/farms/:id/tasks/:taskId
  router.delete("/farms/:id/tasks/:taskId", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const taskId = req.params.taskId;
      const userId = req.user.id;

      if (!looksLikeId(farmId) || !looksLikeId(taskId)) {
        return res.status(400).json({ error: "IDs inválidos." });
      }

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const existing = await prisma.task.findFirst({
        where: { id: taskId, farmId },
        select: { id: true },
      });
      if (!existing) return res.status(404).json({ error: "Tarea no encontrada." });

      await prisma.task.delete({ where: { id: taskId } });

      return res.json({ ok: true });
    } catch (err) {
      console.error("DELETE_TASK_ERROR:", err);
      return res.status(500).json({ error: "Error interno eliminando tarea." });
    }
  });

  // ==========================================================
  // ✅ FINANZAS (movimientos asociados a finca)
  // ==========================================================

  // GET /api/farms/:id/finance/movements
  router.get("/farms/:id/finance/movements", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const userId = req.user.id;

      if (!looksLikeId(farmId))
        return res.status(400).json({ error: "farmId inválido." });

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const movements = await prisma.financeMovement.findMany({
        where: { farmId },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          farmId: true,
          date: true,
          concept: true,
          category: true,
          type: true,
          amount: true,
          note: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.json({ movements });
    } catch (err) {
      console.error("GET_FINANCE_MOVEMENTS_ERROR:", err);
      return res
        .status(500)
        .json({ error: "Error interno listando movimientos." });
    }
  });

  // POST /api/farms/:id/finance/movements
  router.post("/farms/:id/finance/movements", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const userId = req.user.id;

      if (!looksLikeId(farmId))
        return res.status(400).json({ error: "farmId inválido." });

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const { date, concept, category, type, amount, note } = req.body || {};

      const finalConcept = isNonEmptyString(concept) ? concept.trim().slice(0, 160) : "";
      if (!finalConcept) return res.status(400).json({ error: "concept es requerido." });

      const finalCategory = isNonEmptyString(category)
        ? category.trim().slice(0, 80)
        : "General";

      const finalType = normalizeType(type);
      if (!finalType) return res.status(400).json({ error: 'type debe ser "Ingreso" o "Gasto".' });

      const finalAmount = parseAmount(amount);
      if (finalAmount === null) return res.status(400).json({ error: "amount inválido (debe ser número >= 0)." });

      const finalDate = parseDateAnyToUTC(date) || new Date();
      if (!finalDate) return res.status(400).json({ error: "date inválida." });

      const finalNote = isNonEmptyString(note) ? note.trim().slice(0, 240) : null;

      const movement = await prisma.financeMovement.create({
        data: {
          farmId,
          date: finalDate,
          concept: finalConcept,
          category: finalCategory,
          type: finalType,
          amount: finalAmount,
          note: finalNote,
        },
        select: {
          id: true,
          farmId: true,
          date: true,
          concept: true,
          category: true,
          type: true,
          amount: true,
          note: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.status(201).json({ movement });
    } catch (err) {
      console.error("CREATE_FINANCE_MOVEMENT_ERROR:", err);
      return res.status(500).json({ error: "Error interno creando movimiento." });
    }
  });

  // PUT /api/farms/:id/finance/movements/:movementId
  router.put(
    "/farms/:id/finance/movements/:movementId",
    requireAuth,
    async (req, res) => {
      try {
        const farmId = req.params.id;
        const movementId = req.params.movementId;
        const userId = req.user.id;

        if (!looksLikeId(farmId) || !looksLikeId(movementId)) {
          return res.status(400).json({ error: "IDs inválidos." });
        }

        const farm = await assertFarmOwner(farmId, userId);
        if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

        const existing = await prisma.financeMovement.findFirst({
          where: { id: movementId, farmId },
          select: { id: true },
        });
        if (!existing) return res.status(404).json({ error: "Movimiento no encontrado." });

        const { date, concept, category, type, amount, note } = req.body || {};

        const data = {};

        if (concept !== undefined) {
          const finalConcept = isNonEmptyString(concept)
            ? concept.trim().slice(0, 160)
            : "";
          if (!finalConcept) return res.status(400).json({ error: "concept inválido." });
          data.concept = finalConcept;
        }

        if (category !== undefined) {
          data.category = isNonEmptyString(category)
            ? category.trim().slice(0, 80)
            : "General";
        }

        if (type !== undefined) {
          const finalType = normalizeType(type);
          if (!finalType)
            return res.status(400).json({ error: 'type debe ser "Ingreso" o "Gasto".' });
          data.type = finalType;
        }

        if (amount !== undefined) {
          const finalAmount = parseAmount(amount);
          if (finalAmount === null)
            return res.status(400).json({ error: "amount inválido (debe ser número >= 0)." });
          data.amount = finalAmount;
        }

        if (date !== undefined) {
          const finalDate = parseDateAnyToUTC(date);
          if (!finalDate) return res.status(400).json({ error: "date inválida." });
          data.date = finalDate;
        }

        if (note !== undefined) {
          data.note = isNonEmptyString(note) ? note.trim().slice(0, 240) : null;
        }

        const movement = await prisma.financeMovement.update({
          where: { id: movementId },
          data,
          select: {
            id: true,
            farmId: true,
            date: true,
            concept: true,
            category: true,
            type: true,
            amount: true,
            note: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        return res.json({ ok: true, movement });
      } catch (err) {
        console.error("UPDATE_FINANCE_MOVEMENT_ERROR:", err);
        return res.status(500).json({ error: "Error interno actualizando movimiento." });
      }
    }
  );

  // DELETE /api/farms/:id/finance/movements/:movementId
  router.delete(
    "/farms/:id/finance/movements/:movementId",
    requireAuth,
    async (req, res) => {
      try {
        const farmId = req.params.id;
        const movementId = req.params.movementId;
        const userId = req.user.id;

        if (!looksLikeId(farmId) || !looksLikeId(movementId)) {
          return res.status(400).json({ error: "IDs inválidos." });
        }

        const farm = await assertFarmOwner(farmId, userId);
        if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

        const existing = await prisma.financeMovement.findFirst({
          where: { id: movementId, farmId },
          select: { id: true },
        });
        if (!existing) return res.status(404).json({ error: "Movimiento no encontrado." });

        await prisma.financeMovement.delete({ where: { id: movementId } });

        return res.json({ ok: true });
      } catch (err) {
        console.error("DELETE_FINANCE_MOVEMENT_ERROR:", err);
        return res.status(500).json({ error: "Error interno eliminando movimiento." });
      }
    }
  );

  return router;
}