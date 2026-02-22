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

function parseInvoiceNumber(v) {
  if (v === undefined) return undefined; // no tocar si no viene
  if (v === null) return null;
  if (!isNonEmptyString(v)) return null;
  return v.trim().slice(0, 80);
}

// Clasificación simple por palabras clave (solo si categoría es vacía/General)
function classifyCategoryByConcept(concept) {
  const t = String(concept || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const dict = [
    { keys: ["urea", "fertiliz", "abono"], cat: "Fertilizantes" },
    { keys: ["concentrado", "alimento", "melaza"], cat: "Alimentación" },
    { keys: ["diesel", "diésel", "gasolina", "combustible"], cat: "Transporte" },
    { keys: ["vacuna", "vitamina", "desparas", "sanidad"], cat: "Sanidad" },
  ];

  for (const d of dict) {
    if (d.keys.some((k) => t.includes(k))) return d.cat;
  }
  return null;
}

function monthKeyUTC(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function startOfUTCMonth(year, monthIndex0) {
  return new Date(Date.UTC(year, monthIndex0, 1, 0, 0, 0));
}

function endOfUTCMonth(year, monthIndex0) {
  return new Date(Date.UTC(year, monthIndex0 + 1, 1, 0, 0, 0));
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
          invoiceNumber: true,
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

      const { date, concept, category, type, amount, invoiceNumber, note } = req.body || {};

      const finalConcept = isNonEmptyString(concept) ? concept.trim().slice(0, 160) : "";
      if (!finalConcept) return res.status(400).json({ error: "concept es requerido." });

      let finalCategory = isNonEmptyString(category)
        ? category.trim().slice(0, 80)
        : "General";

      if (!isNonEmptyString(finalCategory) || finalCategory === "General") {
        const auto = classifyCategoryByConcept(finalConcept);
        if (auto) finalCategory = auto;
      }

      const finalType = normalizeType(type);
      if (!finalType) return res.status(400).json({ error: 'type debe ser "Ingreso" o "Gasto".' });

      const finalAmount = parseAmount(amount);
      if (finalAmount === null) return res.status(400).json({ error: "amount inválido (debe ser número >= 0)." });

      const finalDate = parseDateAnyToUTC(date) || new Date();
      if (!finalDate) return res.status(400).json({ error: "date inválida." });

      const finalInvoiceNumber = parseInvoiceNumber(invoiceNumber);
      const finalNote = isNonEmptyString(note) ? note.trim().slice(0, 240) : null;

      const movement = await prisma.financeMovement.create({
        data: {
          farmId,
          date: finalDate,
          concept: finalConcept,
          category: finalCategory,
          type: finalType,
          amount: finalAmount,
          invoiceNumber: finalInvoiceNumber ?? null,
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
          invoiceNumber: true,
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

        const { date, concept, category, type, amount, invoiceNumber, note } = req.body || {};

        const data = {};

        if (concept !== undefined) {
          const finalConcept = isNonEmptyString(concept)
            ? concept.trim().slice(0, 160)
            : "";
          if (!finalConcept) return res.status(400).json({ error: "concept inválido." });
          data.concept = finalConcept;

          // si además no nos pasan categoría o viene general, podemos autoclasi.
          if (category === undefined && (data.category === undefined)) {
            // no toca category aquí; solo si el usuario no envió category en el body
          }
        }

        if (category !== undefined) {
          let cat = isNonEmptyString(category)
            ? category.trim().slice(0, 80)
            : "General";

          if (!isNonEmptyString(cat) || cat === "General") {
            const baseConcept = data.concept ?? concept;
            const auto = classifyCategoryByConcept(baseConcept);
            if (auto) cat = auto;
          }
          data.category = cat;
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

        if (invoiceNumber !== undefined) {
          data.invoiceNumber = parseInvoiceNumber(invoiceNumber);
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
            invoiceNumber: true,
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

  // ==========================================================
  // ✅ FINANCE INSIGHTS (REAL): GET /api/farms/:id/finance/insights
  // ==========================================================
  router.get("/farms/:id/finance/insights", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const userId = req.user.id;

      if (!looksLikeId(farmId)) {
        return res.status(400).json({ error: "farmId inválido." });
      }

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) {
        return res.status(403).json({ error: "Sin acceso a esa finca." });
      }

      const now = new Date();
      const y = now.getUTCFullYear();
      const m0 = now.getUTCMonth();

      const startThisMonth = startOfUTCMonth(y, m0);
      const startPrevMonth = startOfUTCMonth(y, m0 - 1);
      const endThisMonth = endOfUTCMonth(y, m0);

      // últimos 3 meses para proyección
      const start3Months = startOfUTCMonth(y, m0 - 2);

      // Para detectar “categoría nueva”: histórico anterior al mes actual
      const olderThanThisMonth = startThisMonth;

      const [movThisMonth, movPrevMonth, movLast3, movOlder] = await Promise.all([
        prisma.financeMovement.findMany({
          where: { farmId, date: { gte: startThisMonth, lt: endThisMonth } },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          select: {
            id: true,
            date: true,
            concept: true,
            category: true,
            type: true,
            amount: true,
            invoiceNumber: true,
            note: true,
            createdAt: true,
          },
        }),
        prisma.financeMovement.findMany({
          where: { farmId, date: { gte: startPrevMonth, lt: startThisMonth } },
          select: { id: true, date: true, concept: true, category: true, type: true, amount: true },
        }),
        prisma.financeMovement.findMany({
          where: { farmId, date: { gte: start3Months, lt: endThisMonth } },
          select: { id: true, date: true, category: true, type: true, amount: true },
        }),
        prisma.financeMovement.findMany({
          where: { farmId, date: { lt: olderThanThisMonth } },
          select: { id: true, category: true },
        }),
      ]);

      function sumByType(list) {
        let ingresos = 0;
        let gastos = 0;
        for (const mv of list) {
          const a = Number(mv.amount || 0);
          if (mv.type === "Ingreso") ingresos += a;
          else if (mv.type === "Gasto") gastos += a;
        }
        const balance = ingresos - gastos;
        const margin = ingresos > 0 ? (balance / ingresos) * 100 : 0;
        return { ingresos, gastos, balance, margin };
      }

      const sThis = sumByType(movThisMonth);
      const sPrev = sumByType(movPrevMonth);

      const variation = {
        ingresos: sPrev.ingresos > 0 ? ((sThis.ingresos - sPrev.ingresos) / sPrev.ingresos) * 100 : (sThis.ingresos > 0 ? 100 : 0),
        gastos: sPrev.gastos > 0 ? ((sThis.gastos - sPrev.gastos) / sPrev.gastos) * 100 : (sThis.gastos > 0 ? 100 : 0),
        balance: sPrev.balance !== 0 ? ((sThis.balance - sPrev.balance) / Math.abs(sPrev.balance)) * 100 : (sThis.balance !== 0 ? 100 : 0),
      };

      // Top categorías del mes (por monto absoluto)
      const catMap = new Map();
      for (const mv of movThisMonth) {
        const cat = (mv.category || "General").trim() || "General";
        const prev = catMap.get(cat) || { category: cat, total: 0 };
        prev.total += Number(mv.amount || 0);
        catMap.set(cat, prev);
      }
      const topCategories = Array.from(catMap.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 3);

      // Anomalías
      const anomalies = [];

      // 1) Duplicado exacto: fecha(YYYY-MM-DD)+monto+concepto
      const seenDup = new Set();
      const dupHits = new Set();
      for (const mv of movThisMonth) {
        const key = `${toYYYYMMDD(mv.date)}|${Number(mv.amount || 0)}|${String(mv.concept || "").trim().toLowerCase()}`;
        if (seenDup.has(key)) dupHits.add(key);
        else seenDup.add(key);
      }
      if (dupHits.size > 0) {
        anomalies.push({
          code: "DUPLICATE_EXACT",
          level: "warning",
          title: "Posibles duplicados",
          message: `Se detectaron ${dupHits.size} posible(s) duplicado(s) exacto(s).`,
          count: dupHits.size,
        });
      }

      // 2) > 2.5x promedio por categoría (en el mes)
      const byCat = new Map();
      for (const mv of movThisMonth) {
        const cat = (mv.category || "General").trim() || "General";
        const arr = byCat.get(cat) || [];
        arr.push(mv);
        byCat.set(cat, arr);
      }

      for (const [cat, arr] of byCat.entries()) {
        if (arr.length < 3) continue; // no inventamos anomalías con 1-2 datos
        const avg = arr.reduce((s, x) => s + Number(x.amount || 0), 0) / arr.length;
        const threshold = avg * 2.5;

        const big = arr.filter((x) => Number(x.amount || 0) > threshold);
        if (big.length > 0) {
          anomalies.push({
            code: "CATEGORY_OUTLIER",
            level: "warning",
            title: "Monto inusual por categoría",
            message: `En "${cat}" hay ${big.length} movimiento(s) muy por encima del promedio.`,
            category: cat,
            count: big.length,
          });
        }
      }

      // 3) Categoría nueva nunca usada (comparado contra histórico anterior)
      const olderCats = new Set(movOlder.map((x) => (x.category || "General").trim() || "General"));
      const newCats = new Set();
      for (const mv of movThisMonth) {
        const cat = (mv.category || "General").trim() || "General";
        if (!olderCats.has(cat)) newCats.add(cat);
      }
      if (newCats.size > 0) {
        anomalies.push({
          code: "NEW_CATEGORY",
          level: "info",
          title: "Categorías nuevas",
          message: `Aparecieron ${newCats.size} categoría(s) que no se habían usado antes.`,
          categories: Array.from(newCats).slice(0, 6),
        });
      }

      // Score salud financiera (0-100)
      const generalCount = movThisMonth.filter((mvv) => (mvv.category || "").trim() === "" || (mvv.category || "").trim() === "General").length;
      const uncategorizedCount = movThisMonth.filter((mvv) => !isNonEmptyString(mvv.category)).length;

      let score = 50;
      // margen
      if (sThis.margin > 0) score += Math.min(25, sThis.margin * 0.5);
      else score -= Math.min(25, Math.abs(sThis.margin) * 0.5);

      // crecimiento balance vs mes anterior
      if (sPrev.balance !== 0) {
        const growth = (sThis.balance - sPrev.balance) / Math.abs(sPrev.balance);
        score += Math.max(-15, Math.min(15, growth * 15));
      }

      // penalizaciones por mala calidad de datos
      score -= Math.min(20, generalCount * 2);
      score -= Math.min(10, uncategorizedCount * 3);

      score = Math.max(0, Math.min(100, Math.round(score)));

      // Proyección 30/90 (promedio neto mensual últimos 3 meses)
      const byMonth = new Map();
      for (const mv of movLast3) {
        const mk = monthKeyUTC(mv.date);
        if (!mk) continue;
        const prev = byMonth.get(mk) || { ingresos: 0, gastos: 0, neto: 0 };
        const a = Number(mv.amount || 0);
        if (mv.type === "Ingreso") prev.ingresos += a;
        else if (mv.type === "Gasto") prev.gastos += a;
        prev.neto = prev.ingresos - prev.gastos;
        byMonth.set(mk, prev);
      }
      const months = Array.from(byMonth.keys()).sort();
      const last3 = months.slice(-3);
      const avgNet =
        last3.length > 0
          ? last3.reduce((acc, mk) => acc + (byMonth.get(mk)?.neto || 0), 0) / last3.length
          : 0;

      const projection30 = Math.round(avgNet);
      const projection90 = Math.round(avgNet * 3);

      // Auditor de datos
      const genericConcept = (c) => {
        const t = String(c || "").trim().toLowerCase();
        if (!t) return true;
        if (t.length <= 5) return true;
        return ["varios", "general", "misc", "otros"].some((x) => t === x);
      };

      const audit = {
        missingCategory: uncategorizedCount,
        tooGeneralCategory: generalCount,
        genericConcept: movThisMonth.filter((mvv) => genericConcept(mvv.concept)).length,
        possibleDuplicates: dupHits.size,
        invoiceMissing: movThisMonth.filter((mvv) => mvv.type === "Gasto" && !isNonEmptyString(mvv.invoiceNumber)).length,
      };

      // Sugerencias finanzas → tareas (basadas en categorías del mes)
      const sug = [];
      const todayStr = toYYYYMMDD(new Date(Date.UTC(y, m0, now.getUTCDate(), 12, 0, 0)));

      const catTotals = Array.from(catMap.values()).sort((a, b) => b.total - a.total);
      const top = catTotals[0]?.category || "";

      const addSuggestion = (id, title, message, payload) => {
        sug.push({
          id,
          title,
          message,
          actionPayload: payload,
        });
      };

      // Reglas simples (producción, sin fantasía)
      const transportTotal = (catMap.get("Transporte")?.total || 0);
      const feedTotal = (catMap.get("Alimentación")?.total || 0);
      const fertTotal = (catMap.get("Fertilizantes")?.total || 0);

      if (transportTotal > 0) {
        addSuggestion(
          "FIN_TRANSPORT_OPT",
          "Optimizar rutas y combustible",
          `Gasto relevante en Transporte este mes.`,
          {
            title: "Optimizar rutas y consumo de combustible",
            zone: "",
            type: "Operación",
            priority: "Media",
            start: todayStr,
            due: todayStr,
            status: "Pendiente",
            owner: "",
          }
        );
      }

      if (feedTotal > 0) {
        addSuggestion(
          "FIN_FEED_EFF",
          "Revisar eficiencia de alimentación",
          `Hay gasto en Alimentación este mes. Revisá consumo vs rendimiento.`,
          {
            title: "Revisar eficiencia de alimentación",
            zone: "",
            type: "Alimentación",
            priority: "Media",
            start: todayStr,
            due: todayStr,
            status: "Pendiente",
            owner: "",
          }
        );
      }

      if (fertTotal > 0) {
        addSuggestion(
          "FIN_FERT_PLAN",
          "Planificar fertilización",
          `Movimiento(s) en Fertilizantes este mes. Alineá compras con calendario técnico.`,
          {
            title: "Planificar fertilización según calendario",
            zone: "",
            type: "Mantenimiento",
            priority: "Media",
            start: todayStr,
            due: todayStr,
            status: "Pendiente",
            owner: "",
          }
        );
      }

      // fallback suave si no hay nada útil
      if (sug.length === 0 && top) {
        addSuggestion(
          "FIN_REVIEW_TOPCAT",
          "Revisar principal categoría",
          `La categoría con mayor movimiento es "${top}". Revisá si está optimizada.`,
          {
            title: `Revisión financiera de categoría: ${top}`,
            zone: "",
            type: "Finanzas",
            priority: "Media",
            start: todayStr,
            due: todayStr,
            status: "Pendiente",
            owner: "",
          }
        );
      }

      return res.json({
        summary: {
          month: monthKeyUTC(now),
          ingresos: sThis.ingresos,
          gastos: sThis.gastos,
          balance: sThis.balance,
          margen: Number(sThis.margin.toFixed(2)),
          variation,
        },
        topCategories,
        anomalies,
        healthScore: score,
        projection30,
        projection90,
        audit,
        suggestions: sug,
      });
    } catch (err) {
      console.error("GET_FINANCE_INSIGHTS_ERROR:", err);
      return res.status(500).json({ error: "Error generando insights." });
    }
  });

  return router;
}