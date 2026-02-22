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
  if (!isNonEmptyString(dateStr)) return null;
  const s = dateStr.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function parseDateAnyToUTC(value) {
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

function toYYYYMMDD(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
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

      const finalName = cleanName(name, "Mi finca");
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
          start: true,
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

  // ✅ IA INTERNA: Sugerencias de tareas
  // GET /api/farms/:id/tasks/suggestions
  router.get("/farms/:id/tasks/suggestions", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const userId = req.user.id;

      if (!looksLikeId(farmId))
        return res.status(400).json({ error: "farmId inválido." });

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const tasks = await prisma.task.findMany({
        where: { farmId },
        select: {
          id: true,
          title: true,
          zone: true,
          type: true,
          priority: true,
          status: true,
          start: true,
          due: true,
          owner: true,
          createdAt: true,
        },
      });

      // ✅ zonas + components
      const zones = await prisma.mapZone.findMany({
        where: { farmId },
        select: { name: true, components: true },
      });

      // Helpers tiempo
      const MS_DAY = 1000 * 60 * 60 * 24;
      const now = new Date();
      const todayUtcNoon = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          12,
          0,
          0
        )
      );

      const suggestions = [];
      const seen = new Set(); // evitar duplicados exactos

      function pushSuggestion(s) {
        const key = `${s.code}:${s.zone || ""}:${s.title || ""}:${s.due || ""}:${s.message || ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        suggestions.push(s);
      }

      function normText(s) {
        return String(s || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim();
      }

      function hasSimilarActiveTask(zoneName, keywords = []) {
        const zn = normText(zoneName);
        const keys = keywords.map(normText).filter(Boolean);

        return tasks.some((t) => {
          if (!t || t.status === "Completada") return false;
          const tZone = normText(t.zone || "");
          if (zn && tZone !== zn) return false;

          const hay = normText(`${t.title || ""} ${t.type || ""}`);
          if (keys.length === 0) return false;
          return keys.some((k) => k && hay.includes(k));
        });
      }

      // -------------------------
      // COMPONENTS PARSER (tolerante)
      // -------------------------
      function listFromUnknown(x) {
        if (!x) return [];
        if (Array.isArray(x)) return x;
        if (typeof x === "string") return [x];
        if (typeof x === "object") {
          const out = [];
          for (const [k, v] of Object.entries(x)) {
            if (!k) continue;
            if (v === true) out.push(k);
            else if (typeof v === "number" && v > 0) out.push(`${k} (${v})`);
            else if (typeof v === "string" && v.trim()) out.push(v.trim());
            else if (v && typeof v === "object" && (v.name || v.tipo)) {
              out.push(String(v.name || v.tipo || k));
            }
          }
          return out;
        }
        return [];
      }

      // ✅ FIX CLAVE: escoger el primer arreglo NO VACÍO (no usar || con arrays)
      function firstNonEmptyList(...candidates) {
        for (const cand of candidates) {
          const arr = listFromUnknown(cand);
          if (Array.isArray(arr) && arr.length > 0) return arr;
        }
        return [];
      }

      function extractComponents(components) {
        const c = components && typeof components === "object" ? components : {};

        const crops = firstNonEmptyList(
          c.cultivos,
          c.cultivo,
          c.crops,
          c.crop,
          c.plantas,
          c.planta
        );

        const animals = firstNonEmptyList(
          c.animales,
          c.animal,
          c.animals,
          c.animalList,
          c.ganado
        );

        // fallback: llaves sueltas y no se detectó crops/animals
        let other = [];
        if (crops.length === 0 && animals.length === 0) {
          other = listFromUnknown(c);
        }

        const cleanArr = (arr) =>
          (Array.isArray(arr) ? arr : [])
            .map((x) => String(x || "").trim())
            .filter(Boolean)
            .slice(0, 12);

        return {
          crops: cleanArr(crops),
          animals: cleanArr(animals),
          other: cleanArr(other),
        };
      }

      // ==========================================================
      // 0) Sugerencias guiadas por COMPONENTS
      // ==========================================================
      const zoneNames = zones
        .map((z) => (isNonEmptyString(z?.name) ? z.name.trim() : ""))
        .filter(Boolean);

      const todayStr = toYYYYMMDD(todayUtcNoon);

      for (const z of zones) {
        const zoneName = isNonEmptyString(z?.name) ? z.name.trim() : "";
        if (!zoneName) continue;

        const { crops, animals, other } = extractComponents(z.components);

        // Cultivos
        for (const crop of crops) {
          if (!hasSimilarActiveTask(zoneName, ["abonar", "fertiliz", crop])) {
            pushSuggestion({
              id: `crop_${zoneName}_${crop}`.slice(0, 180),
              code: "ZONE_COMPONENT_CROP",
              level: "info",
              title: "Acción recomendada para cultivo",
              message: `Zona "${zoneName}": revisar y planificar labores para el cultivo (${crop}).`,
              zone: zoneName,
              actionPayload: {
                title: `Revisión de cultivo (${crop})`,
                zone: zoneName,
                type: "Mantenimiento",
                priority: "Media",
                start: todayStr,
                due: todayStr,
                status: "Pendiente",
                owner: "",
              },
            });
          }

          if (!hasSimilarActiveTask(zoneName, ["poda", "podar", crop])) {
            pushSuggestion({
              id: `prune_${zoneName}_${crop}`.slice(0, 180),
              code: "ZONE_COMPONENT_CROP_PRUNE",
              level: "info",
              title: "Mantenimiento del cultivo",
              message: `Zona "${zoneName}": considerar poda/limpieza y control de malezas para (${crop}).`,
              zone: zoneName,
              actionPayload: {
                title: `Poda/limpieza (${crop})`,
                zone: zoneName,
                type: "Mantenimiento",
                priority: "Media",
                start: todayStr,
                due: todayStr,
                status: "Pendiente",
                owner: "",
              },
            });
          }
        }

        // Animales
        for (const animal of animals) {
          if (!hasSimilarActiveTask(zoneName, ["aliment", "agua", animal])) {
            pushSuggestion({
              id: `animal_feed_${zoneName}_${animal}`.slice(0, 180),
              code: "ZONE_COMPONENT_ANIMAL_FEED",
              level: "info",
              title: "Rutina de animales",
              message: `Zona "${zoneName}": revisar agua y alimentación para (${animal}).`,
              zone: zoneName,
              actionPayload: {
                title: `Revisar agua/alimento (${animal})`,
                zone: zoneName,
                type: "Alimentación",
                priority: "Media",
                start: todayStr,
                due: todayStr,
                status: "Pendiente",
                owner: "",
              },
            });
          }

          if (!hasSimilarActiveTask(zoneName, ["limpieza", "higiene", "corral", animal])) {
            pushSuggestion({
              id: `animal_clean_${zoneName}_${animal}`.slice(0, 180),
              code: "ZONE_COMPONENT_ANIMAL_CLEAN",
              level: "info",
              title: "Orden y limpieza",
              message: `Zona "${zoneName}": planificar limpieza/orden del área para (${animal}).`,
              zone: zoneName,
              actionPayload: {
                title: `Limpieza del área (${animal})`,
                zone: zoneName,
                type: "Mantenimiento",
                priority: "Media",
                start: todayStr,
                due: todayStr,
                status: "Pendiente",
                owner: "",
              },
            });
          }

          if (
            !hasSimilarActiveTask(zoneName, [
              "revision sanitaria",
              "sanidad",
              "vacun",
              "desparas",
              animal,
            ])
          ) {
            pushSuggestion({
              id: `animal_health_${zoneName}_${animal}`.slice(0, 180),
              code: "ZONE_COMPONENT_ANIMAL_HEALTH",
              level: "info",
              title: "Chequeo sanitario",
              message: `Zona "${zoneName}": revisar plan sanitario (ej. vacunas/desparasitación) para (${animal}) según tu calendario.`,
              zone: zoneName,
              actionPayload: {
                title: `Chequeo sanitario (${animal})`,
                zone: zoneName,
                type: "Mantenimiento",
                priority: "Media",
                start: todayStr,
                due: todayStr,
                status: "Pendiente",
                owner: "",
              },
            });
          }
        }

        // Otros → inspección genérica
        if (crops.length === 0 && animals.length === 0 && other.length > 0) {
          if (!hasSimilarActiveTask(zoneName, ["inspeccion", "inspección", "revision", "revisión"])) {
            pushSuggestion({
              id: `zone_other_${zoneName}`.slice(0, 180),
              code: "ZONE_COMPONENT_OTHER",
              level: "info",
              title: "Inspección por componentes",
              message: `Zona "${zoneName}": hay componentes registrados. Recomendación: inspección preventiva y actualización de tareas.`,
              zone: zoneName,
              actionPayload: {
                title: `Inspección preventiva (${zoneName})`,
                zone: zoneName,
                type: "Mantenimiento",
                priority: "Media",
                start: todayStr,
                due: todayStr,
                status: "Pendiente",
                owner: "",
              },
            });
          }
        }
      }

      // ==========================================================
      // 1) Regla: vencen pronto (<= 2 días)
      // ==========================================================
      for (const t of tasks) {
        if (!t?.due || !t?.title) continue;
        if (t.status === "Completada") continue;

        const dueDate = new Date(t.due);
        const diffDays = Math.ceil((dueDate.getTime() - todayUtcNoon.getTime()) / MS_DAY);

        if (diffDays >= 0 && diffDays <= 2) {
          const dueStr = toYYYYMMDD(dueDate);
          const startStr = toYYYYMMDD(t.start || dueDate);

          pushSuggestion({
            id: `due_soon_${t.id}`,
            code: "DUE_SOON",
            level: diffDays === 0 ? "alert" : "warning",
            title: diffDays === 0 ? "Vence hoy" : "Vence pronto",
            message:
              diffDays === 0
                ? `La tarea "${t.title}" vence hoy.`
                : `La tarea "${t.title}" vence en ${diffDays} día(s).`,
            zone: t.zone || null,
            actionPayload: {
              title: `Seguimiento: ${t.title}`,
              zone: t.zone || "",
              type: t.type || "Mantenimiento",
              priority: "Alta",
              start: startStr,
              due: dueStr,
              status: "Pendiente",
              owner: t.owner || "",
            },
          });
        }
      }

      // ==========================================================
      // 2) Regla: zonas sin tareas activas
      // ==========================================================
      for (const zn of zoneNames) {
        const hasActive = tasks.some(
          (t) => (t.zone || "").trim() === zn && t.status !== "Completada"
        );
        if (!hasActive) {
          pushSuggestion({
            id: `zone_empty_${zn}`,
            code: "ZONE_NO_ACTIVE_TASKS",
            level: "info",
            title: "Zona sin tareas activas",
            message: `La zona "${zn}" no tiene tareas activas.`,
            zone: zn,
            actionPayload: {
              title: `Inspección preventiva - ${zn}`,
              zone: zn,
              type: "Mantenimiento",
              priority: "Media",
              start: todayStr,
              due: todayStr,
              status: "Pendiente",
              owner: "",
            },
          });
        }
      }

      // ==========================================================
      // 3) Regla: demasiadas pendientes (>= 5)
      // ==========================================================
      const pendingCount = tasks.filter((t) => t.status === "Pendiente").length;
      if (pendingCount >= 5) {
        pushSuggestion({
          id: `too_many_pending_${pendingCount}`,
          code: "TOO_MANY_PENDING",
          level: "warning",
          title: "Carga alta de pendientes",
          message: `Tenés ${pendingCount} tareas en estado "Pendiente". Considerá priorizar o dividir trabajo.`,
          zone: null,
          actionPayload: null,
        });
      }

      // ==========================================================
      // 4) Regla: atrasadas
      // ==========================================================
      for (const t of tasks) {
        if (!t?.due || !t?.title) continue;
        if (t.status === "Completada") continue;

        const dueDate = new Date(t.due);
        const diffDays = Math.floor((todayUtcNoon.getTime() - dueDate.getTime()) / MS_DAY);
        if (diffDays >= 1) {
          const dueStr = toYYYYMMDD(dueDate);
          const startStr = toYYYYMMDD(t.start || dueDate);

          pushSuggestion({
            id: `overdue_${t.id}`,
            code: "OVERDUE",
            level: "alert",
            title: "Tarea atrasada",
            message: `La tarea "${t.title}" está atrasada por ${diffDays} día(s).`,
            zone: t.zone || null,
            actionPayload: {
              title: `Reprogramar: ${t.title}`,
              zone: t.zone || "",
              type: t.type || "Mantenimiento",
              priority: "Alta",
              start: startStr,
              due: toYYYYMMDD(todayUtcNoon),
              status: "Pendiente",
              owner: t.owner || "",
            },
          });
        }
      }

      return res.json({ suggestions });
    } catch (err) {
      console.error("TASK_SUGGESTIONS_ERROR:", err);
      return res.status(500).json({ error: "Error generando sugerencias." });
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

      const { title, zone, type, priority, start, due, status, owner } = req.body || {};

      const finalTitle = cleanName(title, "");
      if (!finalTitle) {
        return res.status(400).json({ error: "title es requerido." });
      }

      const finalType = cleanName(type, "Mantenimiento");
      const finalPriority = cleanName(priority, "Media");
      const finalStatus = cleanName(status, "Pendiente");
      const finalZone = isNonEmptyString(zone) ? zone.trim().slice(0, 120) : null;
      const finalOwner = isNonEmptyString(owner) ? owner.trim().slice(0, 80) : null;

      const startDate = parseISODateOnlyToUTC(start);
      if (!startDate) {
        return res.status(400).json({ error: "start debe ser YYYY-MM-DD." });
      }

      const dueDate = parseISODateOnlyToUTC(due);
      if (!dueDate) {
        return res.status(400).json({ error: "due debe ser YYYY-MM-DD." });
      }

      if (startDate.getTime() > dueDate.getTime()) {
        return res.status(400).json({ error: "start no puede ser posterior a due." });
      }

      const task = await prisma.task.create({
        data: {
          farmId,
          title: finalTitle,
          zone: finalZone,
          type: finalType,
          priority: finalPriority,
          start: startDate,
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
          start: true,
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
        select: { id: true, start: true, due: true },
      });
      if (!existing) return res.status(404).json({ error: "Tarea no encontrada." });

      const { title, zone, type, priority, start, due, status, owner } = req.body || {};

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

      let nextStart = existing.start;
      let nextDue = existing.due;

      if (start !== undefined) {
        const startDate = parseISODateOnlyToUTC(start);
        if (!startDate) return res.status(400).json({ error: "start debe ser YYYY-MM-DD." });
        data.start = startDate;
        nextStart = startDate;
      }

      if (due !== undefined) {
        const dueDate = parseISODateOnlyToUTC(due);
        if (!dueDate) return res.status(400).json({ error: "due debe ser YYYY-MM-DD." });
        data.due = dueDate;
        nextDue = dueDate;
      }

      if (nextStart.getTime() > nextDue.getTime()) {
        return res.status(400).json({ error: "start no puede ser posterior a due." });
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
          start: true,
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