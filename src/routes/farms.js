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

function monthKeyUTC(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function startOfMonthUTC(date) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0));
}

function startOfNextMonthUTC(date) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0));
}

function prevMonthKey(monthYYYYMM) {
  if (!/^\d{4}-\d{2}$/.test(monthYYYYMM)) return "";
  const [y, m] = monthYYYYMM.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, 15, 12, 0, 0));
  dt.setUTCMonth(dt.getUTCMonth() - 1);
  return monthKeyUTC(dt);
}

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function keywordCategory(concept, category) {
  // Si ya viene categoría, la respetamos; si viene "General" tratamos de mejorar.
  const cat = isNonEmptyString(category) ? category.trim() : "General";
  const hay = normalizeText(`${concept || ""} ${cat}`);

  const dict = [
    { keys: ["urea", "fertiliz", "abono"], category: "Fertilizantes" },
    { keys: ["concentrado", "alimento", "balanceado"], category: "Alimentación" },
    { keys: ["diesel", "diésel", "gasolina", "combustible"], category: "Transporte" },
    { keys: ["vacuna", "desparas", "vitamina"], category: "Sanidad" },
    { keys: ["manguera", "riego", "aspersor", "bomba"], category: "Riego" },
    { keys: ["repuesto", "mantenimiento", "taller"], category: "Mantenimiento" },
  ];

  if (cat && cat !== "General") return cat;

  for (const row of dict) {
    if (row.keys.some((k) => hay.includes(normalizeText(k)))) return row.category;
  }
  return cat || "General";
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

  async function assertAssetOwner(assetId, farmId) {
    return prisma.asset.findFirst({
      where: { id: assetId, farmId },
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

      // ✅ FIX CLAVE: escoger el primer arreglo NO VACÍO
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

        // fallback: llaves sueltas
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

      const zoneNames = zones
        .map((z) => (isNonEmptyString(z?.name) ? z.name.trim() : ""))
        .filter(Boolean);

      const todayStr = toYYYYMMDD(todayUtcNoon);

      // 0) Sugerencias guiadas por COMPONENTS
      for (const z of zones) {
        const zoneName = isNonEmptyString(z?.name) ? z.name.trim() : "";
        if (!zoneName) continue;

        const { crops, animals, other } = extractComponents(z.components);

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
        }

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
        }

        if (crops.length === 0 && animals.length === 0 && other.length > 0) {
          if (!hasSimilarActiveTask(zoneName, ["inspeccion", "revision"])) {
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

      // 1) vencen pronto (<=2 días)
      for (const t of tasks) {
        if (!t?.due || !t?.title) continue;
        if (t.status === "Completada") continue;

        const dueDate = new Date(t.due);
        const diffDays = Math.ceil((dueDate.getTime() - todayUtcNoon.getTime()) / MS_DAY);

        if (diffDays >= 0 && diffDays <= 2) {
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
              start: toYYYYMMDD(t.start || dueDate),
              due: toYYYYMMDD(dueDate),
              status: "Pendiente",
              owner: t.owner || "",
            },
          });
        }
      }

      // 2) zonas sin tareas activas
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

      // 3) demasiadas pendientes (>=5)
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

      // 4) atrasadas
      for (const t of tasks) {
        if (!t?.due || !t?.title) continue;
        if (t.status === "Completada") continue;

        const dueDate = new Date(t.due);
        const diffDays = Math.floor((todayUtcNoon.getTime() - dueDate.getTime()) / MS_DAY);
        if (diffDays >= 1) {
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
              start: toYYYYMMDD(t.start || dueDate),
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
          invoiceNumber: true, // ✅ PASO 1
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

      const { date, concept, category, type, amount, note, invoiceNumber } = req.body || {};

      const finalConcept = isNonEmptyString(concept) ? concept.trim().slice(0, 160) : "";
      if (!finalConcept) return res.status(400).json({ error: "concept es requerido." });

      const rawCategory = isNonEmptyString(category)
        ? category.trim().slice(0, 80)
        : "General";

      const finalCategory = keywordCategory(finalConcept, rawCategory);

      const finalType = normalizeType(type);
      if (!finalType) return res.status(400).json({ error: 'type debe ser "Ingreso" o "Gasto".' });

      const finalAmount = parseAmount(amount);
      if (finalAmount === null) return res.status(400).json({ error: "amount inválido (debe ser número >= 0)." });

      const finalDate = parseDateAnyToUTC(date) || new Date();
      if (!finalDate) return res.status(400).json({ error: "date inválida." });

      const finalNote = isNonEmptyString(note) ? note.trim().slice(0, 240) : null;

      const finalInvoiceNumber = isNonEmptyString(invoiceNumber)
        ? invoiceNumber.trim().slice(0, 60)
        : null;

      const movement = await prisma.financeMovement.create({
        data: {
          farmId,
          date: finalDate,
          concept: finalConcept,
          category: finalCategory,
          type: finalType,
          amount: finalAmount,
          note: finalNote,
          invoiceNumber: finalInvoiceNumber, // ✅ PASO 1
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
          invoiceNumber: true,
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
          select: { id: true, concept: true, category: true },
        });
        if (!existing) return res.status(404).json({ error: "Movimiento no encontrado." });

        const { date, concept, category, type, amount, note, invoiceNumber } = req.body || {};

        const data = {};

        let nextConcept = existing.concept;
        let nextCategory = existing.category;

        if (concept !== undefined) {
          const finalConcept = isNonEmptyString(concept)
            ? concept.trim().slice(0, 160)
            : "";
          if (!finalConcept) return res.status(400).json({ error: "concept inválido." });
          data.concept = finalConcept;
          nextConcept = finalConcept;
        }

        if (category !== undefined) {
          const rawCategory = isNonEmptyString(category)
            ? category.trim().slice(0, 80)
            : "General";
          data.category = rawCategory;
          nextCategory = rawCategory;
        }

        // Re-clasificación ligera si quedó General
        if (data.concept !== undefined || data.category !== undefined) {
          const computed = keywordCategory(nextConcept, nextCategory);
          data.category = computed;
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

        if (invoiceNumber !== undefined) {
          data.invoiceNumber = isNonEmptyString(invoiceNumber)
            ? invoiceNumber.trim().slice(0, 60)
            : null;
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
            invoiceNumber: true,
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

  // ==========================================================
  // ✅ ACTIVOS (PASO 2) — CRUD básico
  // ==========================================================

  router.get("/farms/:id/finance/assets", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const userId = req.user.id;

      if (!looksLikeId(farmId))
        return res.status(400).json({ error: "farmId inválido." });

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const assets = await prisma.asset.findMany({
        where: { farmId },
        orderBy: [{ purchaseDate: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          farmId: true,
          name: true,
          category: true,
          purchaseValue: true,
          purchaseDate: true,
          usefulLifeYears: true,
          residualValue: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.json({ assets });
    } catch (err) {
      console.error("GET_ASSETS_ERROR:", err);
      return res.status(500).json({ error: "Error interno listando activos." });
    }
  });

  router.post("/farms/:id/finance/assets", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const userId = req.user.id;

      if (!looksLikeId(farmId))
        return res.status(400).json({ error: "farmId inválido." });

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const {
        name,
        category,
        purchaseValue,
        purchaseDate,
        usefulLifeYears,
        residualValue,
      } = req.body || {};

      const finalName = isNonEmptyString(name) ? name.trim().slice(0, 120) : "";
      if (!finalName) return res.status(400).json({ error: "name es requerido." });

      const finalCategory = isNonEmptyString(category)
        ? category.trim().slice(0, 60)
        : "Equipos";

      const pv = parseAmount(purchaseValue);
      if (pv === null) return res.status(400).json({ error: "purchaseValue inválido." });

      const rv = residualValue === undefined || residualValue === null
        ? 0
        : parseAmount(residualValue);

      if (rv === null) return res.status(400).json({ error: "residualValue inválido." });

      const pd = parseDateAnyToUTC(purchaseDate) || new Date();
      if (!pd) return res.status(400).json({ error: "purchaseDate inválida." });

      const uly =
        usefulLifeYears === undefined || usefulLifeYears === null
          ? 1
          : Number(usefulLifeYears);

      if (!Number.isFinite(uly) || uly <= 0 || uly > 50) {
        return res.status(400).json({ error: "usefulLifeYears inválido (1–50)." });
      }

      const asset = await prisma.asset.create({
        data: {
          farmId,
          name: finalName,
          category: finalCategory,
          purchaseValue: pv,
          purchaseDate: pd,
          usefulLifeYears: uly,
          residualValue: rv,
        },
        select: {
          id: true,
          farmId: true,
          name: true,
          category: true,
          purchaseValue: true,
          purchaseDate: true,
          usefulLifeYears: true,
          residualValue: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.status(201).json({ asset });
    } catch (err) {
      console.error("CREATE_ASSET_ERROR:", err);
      return res.status(500).json({ error: "Error interno creando activo." });
    }
  });

  router.put("/farms/:id/finance/assets/:assetId", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const assetId = req.params.assetId;
      const userId = req.user.id;

      if (!looksLikeId(farmId) || !looksLikeId(assetId)) {
        return res.status(400).json({ error: "IDs inválidos." });
      }

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const existing = await assertAssetOwner(assetId, farmId);
      if (!existing) return res.status(404).json({ error: "Activo no encontrado." });

      const {
        name,
        category,
        purchaseValue,
        purchaseDate,
        usefulLifeYears,
        residualValue,
      } = req.body || {};

      const data = {};

      if (name !== undefined) {
        const finalName = isNonEmptyString(name) ? name.trim().slice(0, 120) : "";
        if (!finalName) return res.status(400).json({ error: "name inválido." });
        data.name = finalName;
      }

      if (category !== undefined) {
        data.category = isNonEmptyString(category) ? category.trim().slice(0, 60) : "Equipos";
      }

      if (purchaseValue !== undefined) {
        const pv = parseAmount(purchaseValue);
        if (pv === null) return res.status(400).json({ error: "purchaseValue inválido." });
        data.purchaseValue = pv;
      }

      if (purchaseDate !== undefined) {
        const pd = parseDateAnyToUTC(purchaseDate);
        if (!pd) return res.status(400).json({ error: "purchaseDate inválida." });
        data.purchaseDate = pd;
      }

      if (usefulLifeYears !== undefined) {
        const uly = Number(usefulLifeYears);
        if (!Number.isFinite(uly) || uly <= 0 || uly > 50) {
          return res.status(400).json({ error: "usefulLifeYears inválido (1–50)." });
        }
        data.usefulLifeYears = uly;
      }

      if (residualValue !== undefined) {
        const rv = residualValue === null ? 0 : parseAmount(residualValue);
        if (rv === null) return res.status(400).json({ error: "residualValue inválido." });
        data.residualValue = rv;
      }

      const asset = await prisma.asset.update({
        where: { id: assetId },
        data,
        select: {
          id: true,
          farmId: true,
          name: true,
          category: true,
          purchaseValue: true,
          purchaseDate: true,
          usefulLifeYears: true,
          residualValue: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.json({ ok: true, asset });
    } catch (err) {
      console.error("UPDATE_ASSET_ERROR:", err);
      return res.status(500).json({ error: "Error interno actualizando activo." });
    }
  });

  router.delete("/farms/:id/finance/assets/:assetId", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const assetId = req.params.assetId;
      const userId = req.user.id;

      if (!looksLikeId(farmId) || !looksLikeId(assetId)) {
        return res.status(400).json({ error: "IDs inválidos." });
      }

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const existing = await assertAssetOwner(assetId, farmId);
      if (!existing) return res.status(404).json({ error: "Activo no encontrado." });

      await prisma.asset.delete({ where: { id: assetId } });

      return res.json({ ok: true });
    } catch (err) {
      console.error("DELETE_ASSET_ERROR:", err);
      return res.status(500).json({ error: "Error interno eliminando activo." });
    }
  });

  // ==========================================================
  // ✅ INSIGHTS FINANCIEROS (PASO 3)
  // GET /api/farms/:id/finance/insights
  // ==========================================================

  router.get("/farms/:id/finance/insights", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const userId = req.user.id;

      if (!looksLikeId(farmId))
        return res.status(400).json({ error: "farmId inválido." });

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      // Cargamos datos base: movimientos + zonas (para conectar mapa) + tareas (para evitar sugerencias repetidas)
      const [movements, zones, tasks] = await Promise.all([
        prisma.financeMovement.findMany({
          where: { farmId },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          select: {
            id: true,
            date: true,
            concept: true,
            category: true,
            type: true,
            amount: true,
            invoiceNumber: true,
          },
        }),
        prisma.mapZone.findMany({
          where: { farmId },
          select: { name: true, components: true },
        }),
        prisma.task.findMany({
          where: { farmId },
          select: { id: true, title: true, zone: true, status: true },
        }),
      ]);

      const now = new Date();
      const thisMonth = monthKeyUTC(now);
      const prevMonth = prevMonthKey(thisMonth);

      const startThis = startOfMonthUTC(now);
      const startNext = startOfNextMonthUTC(now);

      const monthMovs = movements.filter((m) => {
        const d = new Date(m.date);
        return d >= startThis && d < startNext;
      });

      const prevMovs = movements.filter((m) => monthKeyUTC(m.date) === prevMonth);

      const sumByType = (list) => {
        let ingresos = 0;
        let gastos = 0;
        for (const m of list) {
          const amt = Number(m.amount || 0);
          if (m.type === "Ingreso") ingresos += amt;
          else if (m.type === "Gasto") gastos += amt;
        }
        const balance = ingresos - gastos;
        const margen = ingresos > 0 ? (balance / ingresos) * 100 : 0;
        return { ingresos, gastos, balance, margen };
      };

      const cur = sumByType(monthMovs);
      const prev = sumByType(prevMovs);

      const variation = {
        ingresos: cur.ingresos - prev.ingresos,
        gastos: cur.gastos - prev.gastos,
        balance: cur.balance - prev.balance,
      };

      const summary = {
        month: thisMonth,
        ingresos: cur.ingresos,
        gastos: cur.gastos,
        balance: cur.balance,
        margen: cur.margen,
        variationVsPrev: variation,
      };

      // Top categorías del mes (por monto absoluto)
      const catMap = new Map();
      for (const m of monthMovs) {
        const cat = keywordCategory(m.concept, m.category);
        const prevVal = catMap.get(cat) || 0;
        catMap.set(cat, prevVal + Number(m.amount || 0));
      }
      const topCategories = Array.from(catMap.entries())
        .map(([category, total]) => ({ category, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 3);

      // Auditoría
      const audit = {
        missingCategory: monthMovs.filter((m) => !isNonEmptyString(m.category)).length,
        tooGeneralCategory: monthMovs.filter((m) => (m.category || "") === "General").length,
        genericConcept: monthMovs.filter((m) => {
          const t = normalizeText(m.concept);
          return t === "compra" || t === "venta" || t === "gasto" || t === "ingreso";
        }).length,
        possibleDuplicates: 0,
        invoiceMissing: monthMovs.filter((m) => m.type === "Gasto" && !isNonEmptyString(m.invoiceNumber)).length,
      };

      // Duplicados exactos (fecha+amount+concept)
      const dupSet = new Set();
      let dupCount = 0;
      for (const m of monthMovs) {
        const key = `${toYYYYMMDD(m.date)}|${Number(m.amount || 0)}|${normalizeText(m.concept)}`;
        if (dupSet.has(key)) dupCount += 1;
        else dupSet.add(key);
      }
      audit.possibleDuplicates = dupCount;

      // Anomalías
      const anomalies = [];

      // 1) Movimiento > 2.5x promedio de su categoría (mes)
      const catStats = new Map(); // cat -> {sum, n}
      for (const m of monthMovs) {
        const cat = keywordCategory(m.concept, m.category);
        const s0 = catStats.get(cat) || { sum: 0, n: 0 };
        s0.sum += Number(m.amount || 0);
        s0.n += 1;
        catStats.set(cat, s0);
      }
      for (const m of monthMovs) {
        const cat = keywordCategory(m.concept, m.category);
        const st = catStats.get(cat);
        if (!st || st.n < 3) continue; // si hay muy pocos, no molestar
        const avg = st.sum / st.n;
        if (avg > 0 && Number(m.amount || 0) > 2.5 * avg) {
          anomalies.push({
            title: "Movimiento inusual",
            message: `"${m.concept}" en ${cat} es muy alto vs tu promedio.`,
            movementId: m.id,
          });
        }
      }

      // 2) Duplicado exacto
      if (dupCount > 0) {
        anomalies.push({
          title: "Posibles duplicados",
          message: `Detectamos ${dupCount} movimiento(s) que parecen repetidos.`,
        });
      }

      // 3) Categoría nueva nunca usada antes (histórico)
      const histCats = new Set(movements.map((m) => keywordCategory(m.concept, m.category)));
      const prevCats = new Set(prevMovs.map((m) => keywordCategory(m.concept, m.category)));
      // categoría nueva en este mes vs el mes anterior (se siente “reciente”)
      const newCats = topCategories
        .map((x) => x.category)
        .filter((c) => !prevCats.has(c));
      if (newCats.length > 0) {
        anomalies.push({
          title: "Categoría nueva",
          message: `Este mes apareció una categoría nueva: ${newCats[0]}.`,
        });
      }

      // 4) Pico semanal anormal (simple): semana con gasto > 1.8x promedio semanal
      const weekMap = new Map(); // YYYY-WW -> gastos
      for (const m of monthMovs) {
        if (m.type !== "Gasto") continue;
        const d = new Date(m.date);
        const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0));
        const weekStart = new Date(day);
        // lunes como base
        const dow = (weekStart.getUTCDay() + 6) % 7;
        weekStart.setUTCDate(weekStart.getUTCDate() - dow);
        const key = `${toYYYYMMDD(weekStart)}`;
        weekMap.set(key, (weekMap.get(key) || 0) + Number(m.amount || 0));
      }
      const weeks = Array.from(weekMap.values());
      if (weeks.length >= 2) {
        const avgW = weeks.reduce((a, b) => a + b, 0) / weeks.length;
        const maxW = Math.max(...weeks);
        if (avgW > 0 && maxW > 1.8 * avgW) {
          anomalies.push({
            title: "Pico semanal",
            message: "Se detectó una semana con gastos anormalmente altos.",
          });
        }
      }

      // Health score 0–100 (simple y honesto)
      let score = 50;
      if (cur.balance > 0) score += 15;
      if (cur.ingresos > 0 && cur.margen >= 20) score += 10;
      if (cur.ingresos > 0 && cur.margen < 0) score -= 15;
      if (variation.balance > 0) score += 8;
      if (audit.tooGeneralCategory > 3) score -= 8;
      if (audit.missingCategory > 0) score -= 6;
      if (audit.possibleDuplicates > 0) score -= 6;
      if (audit.invoiceMissing > 2) score -= 6;
      score = Math.max(0, Math.min(100, Math.round(score)));

      // Proyección 30/90 (promedio de 3 meses balance)
      const byMonth = new Map();
      for (const m of movements) {
        const mk = monthKeyUTC(m.date);
        if (!mk) continue;
        const prev = byMonth.get(mk) || { ingresos: 0, gastos: 0 };
        const amt = Number(m.amount || 0);
        if (m.type === "Ingreso") prev.ingresos += amt;
        else if (m.type === "Gasto") prev.gastos += amt;
        byMonth.set(mk, prev);
      }
      const monthsSorted = Array.from(byMonth.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([k, v]) => ({ month: k, ...v, balance: v.ingresos - v.gastos }));

      const last3 = monthsSorted.slice(-3);
      const avgBalance = last3.length
        ? last3.reduce((acc, x) => acc + x.balance, 0) / last3.length
        : 0;

      const projection30 = avgBalance;
      const projection90 = avgBalance * 3;

      // ==========================
      // SUGERENCIAS (Finanzas -> Tareas) + (Mapa -> Tareas)
      // ==========================
      const suggestions = [];
      const seenSug = new Set();

      const hasActiveTaskLike = (kw) => {
        const k = normalizeText(kw);
        return tasks.some((t) => {
          if (!t || t.status === "Completada") return false;
          const hay = normalizeText(`${t.title || ""} ${t.zone || ""}`);
          return hay.includes(k);
        });
      };

      const pushSug = (s) => {
        const key = `${s.code}|${s.title}|${s.message}`;
        if (seenSug.has(key)) return;
        seenSug.add(key);
        suggestions.push(s);
      };

      // Reglas financieras para sugerir tareas
      const top = topCategories.map((x) => x.category);

      if (top.includes("Transporte")) {
        const totalTransport = catMap.get("Transporte") || 0;
        if (totalTransport > 0 && !hasActiveTaskLike("rutas")) {
          pushSug({
            id: `FIN_TRANSPORTE_${thisMonth}`,
            code: "FIN_HIGH_TRANSPORT",
            title: "Optimizar rutas",
            message: "Gasto alto en transporte/combustible. Recomendación: revisar rutas y recorridos para reducir costos.",
            actionPayload: {
              title: "Optimizar rutas y consumo de combustible",
              zone: "",
              type: "Mantenimiento",
              priority: "Media",
              start: toYYYYMMDD(new Date()),
              due: toYYYYMMDD(new Date()),
              status: "Pendiente",
              owner: "",
            },
          });
        }
      }

      if (top.includes("Alimentación")) {
        if (!hasActiveTaskLike("aliment")) {
          pushSug({
            id: `FIN_ALIMENTACION_${thisMonth}`,
            code: "FIN_HIGH_FEED",
            title: "Revisar eficiencia de alimentación",
            message: "Gasto alto en alimentación. Recomendación: revisar consumo, desperdicio y calendario de suministro.",
            actionPayload: {
              title: "Revisar eficiencia de alimentación",
              zone: "",
              type: "Alimentación",
              priority: "Media",
              start: toYYYYMMDD(new Date()),
              due: toYYYYMMDD(new Date()),
              status: "Pendiente",
              owner: "",
            },
          });
        }
      }

      if (top.includes("Fertilizantes")) {
        if (!hasActiveTaskLike("fertiliz")) {
          pushSug({
            id: `FIN_FERT_${thisMonth}`,
            code: "FIN_HIGH_FERT",
            title: "Optimizar plan de fertilización",
            message: "Inversión alta en fertilizantes. Recomendación: revisar dosis, calendario y necesidades por zona/cultivo.",
            actionPayload: {
              title: "Optimizar plan de fertilización por zona",
              zone: "",
              type: "Mantenimiento",
              priority: "Media",
              start: toYYYYMMDD(new Date()),
              due: toYYYYMMDD(new Date()),
              status: "Pendiente",
              owner: "",
            },
          });
        }
      }

      // Conexión Mapa -> Finanzas -> Tareas (usar componentes para aterrizar sugerencias)
      for (const z of zones) {
        const zoneName = isNonEmptyString(z?.name) ? z.name.trim() : "";
        if (!zoneName) continue;

        const comp = z.components && typeof z.components === "object" ? z.components : {};
        const hasAnimals = !!(comp.animales || comp.animal || comp.animals || comp.ganado);
        const hasCrops = !!(comp.cultivos || comp.cultivo || comp.crops || comp.plantas);

        if (hasAnimals && top.includes("Sanidad") && !hasActiveTaskLike("sanidad")) {
          pushSug({
            id: `MAP_FIN_SANIDAD_${zoneName}_${thisMonth}`.slice(0, 180),
            code: "MAP_FIN_SANIDAD",
            title: `Chequeo sanitario (${zoneName})`,
            message: `Hay gasto relevante en Sanidad y la zona "${zoneName}" tiene animales. Recomendación: chequeo sanitario y control preventivo.`,
            actionPayload: {
              title: `Chequeo sanitario - ${zoneName}`,
              zone: zoneName,
              type: "Mantenimiento",
              priority: "Media",
              start: toYYYYMMDD(new Date()),
              due: toYYYYMMDD(new Date()),
              status: "Pendiente",
              owner: "",
            },
          });
        }

        if (hasCrops && top.includes("Fertilizantes") && !hasActiveTaskLike("fertiliz")) {
          pushSug({
            id: `MAP_FIN_FERT_${zoneName}_${thisMonth}`.slice(0, 180),
            code: "MAP_FIN_FERT",
            title: `Revisión nutricional (${zoneName})`,
            message: `Hay inversión en Fertilizantes y la zona "${zoneName}" tiene cultivos. Recomendación: revisión nutricional y plan por cultivo.`,
            actionPayload: {
              title: `Revisión nutricional - ${zoneName}`,
              zone: zoneName,
              type: "Mantenimiento",
              priority: "Media",
              start: toYYYYMMDD(new Date()),
              due: toYYYYMMDD(new Date()),
              status: "Pendiente",
              owner: "",
            },
          });
        }
      }

      return res.json({
        summary,
        topCategories,
        anomalies: anomalies.slice(0, 6),
        healthScore: score,
        projection30,
        projection90,
        audit,
        suggestions,
      });
    } catch (err) {
      console.error("FINANCE_INSIGHTS_ERROR:", err);
      return res.status(500).json({ error: "Error generando insights financieros." });
    }
  });

  return router;
}