// src/routes/farms.base.js
import express from "express";
import jwt from "jsonwebtoken";

/* =========================
   AUTH
========================= */
export function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Sin token." });

    const secret = process.env.JWT_SECRET;
    if (!secret)
      return res.status(500).json({ error: "Falta JWT_SECRET en el servidor." });

    const payload = jwt.verify(token, secret);
    if (!payload?.sub) return res.status(401).json({ error: "Token inválido." });

    req.user = { id: payload.sub };
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado." });
  }
}

/* =========================
   HELPERS
========================= */
export function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

export function cleanName(v, fallback) {
  const s = isNonEmptyString(v) ? v.trim() : "";
  return s.length ? s.slice(0, 80) : fallback;
}

export function looksLikeId(v) {
  return isNonEmptyString(v) && v.trim().length >= 8;
}

function safeClientId(v) {
  // Permitimos id del cliente/servidor, pero con límites razonables.
  // Idealmente aquí llegará cuid() del server luego de cargar el mapa.
  if (!isNonEmptyString(v)) return null;
  const s = v.trim();
  if (s.length < 8) return null;
  if (s.length > 64) return null;
  return s;
}

export function parseISODateOnlyToUTC(dateStr) {
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

export function parseDateAnyToUTC(value) {
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

export function parseAmount(v) {
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

export function normalizeType(v) {
  const s = isNonEmptyString(v) ? v.trim() : "";
  if (s === "Ingreso") return "Ingreso";
  if (s === "Gasto") return "Gasto";
  return null;
}

export function toYYYYMMDD(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function monthKeyUTC(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function startOfMonthUTC(date) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0));
}

export function startOfNextMonthUTC(date) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0)
  );
}

export function prevMonthKey(monthYYYYMM) {
  if (!/^\d{4}-\d{2}$/.test(monthYYYYMM)) return "";
  const [y, m] = monthYYYYMM.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, 15, 12, 0, 0));
  dt.setUTCMonth(dt.getUTCMonth() - 1);
  return monthKeyUTC(dt);
}

export function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function keywordCategory(concept, category) {
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

/* =========================
   CONTEXTO
========================= */
export function createFarmsContext(prisma) {
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

  return {
    prisma,
    router,

    requireAuth,

    assertFarmOwner,
    assertZoneOwner,
    assertAssetOwner,

    isNonEmptyString,
    cleanName,
    looksLikeId,
    parseISODateOnlyToUTC,
    parseDateAnyToUTC,
    parseAmount,
    normalizeType,
    toYYYYMMDD,
    monthKeyUTC,
    startOfMonthUTC,
    startOfNextMonthUTC,
    prevMonthKey,
    normalizeText,
    keywordCategory,
  };
}

/* =========================
   BASE ROUTES (farms + map)
========================= */
export function registerBaseRoutes(ctx) {
  const {
    prisma,
    router,
    requireAuth,
    looksLikeId,
    cleanName,
    assertFarmOwner,
    assertZoneOwner,
  } = ctx;

  // GET /api/farms
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

  // POST /api/farms
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

  // GET /api/farms/:id/map
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
          select: {
            id: true,
            name: true,
            data: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.mapLine.findMany({
          where: { farmId },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            data: true,
            createdAt: true,
            updatedAt: true,
          },
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

  // PUT /api/farms/:id/map
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
        // 1) view (opcional)
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

        // ======================================================
        // 2) DIFF + UPSERT SEGURO (NO deleteMany total)
        //    Esto preserva createdAt y hace updatedAt real.
        // ======================================================

        // ----- POINTS -----
        const pointIds = safePoints
          .map((p) => safeClientId(p?.id))
          .filter(Boolean);

        // Borra puntos que ya no vienen
        if (pointIds.length === 0) {
          await tx.mapPoint.deleteMany({ where: { farmId } });
        } else {
          await tx.mapPoint.deleteMany({
            where: { farmId, id: { notIn: pointIds } },
          });
        }

        // Upsert seguro (updateMany por id+farmId)
        for (const p of safePoints) {
          const id = safeClientId(p?.id);
          const data = p?.data ?? p;
          const name = cleanName(p?.name, "Punto");

          if (id) {
            const up = await tx.mapPoint.updateMany({
              where: { id, farmId },
              data: { name, data },
            });
            if (up.count === 0) {
              await tx.mapPoint.create({
                data: { id, farmId, name, data },
              });
            }
          } else {
            await tx.mapPoint.create({
              data: { farmId, name, data },
            });
          }
        }

        // ----- LINES -----
        const lineIds = safeLines
          .map((l) => safeClientId(l?.id))
          .filter(Boolean);

        if (lineIds.length === 0) {
          await tx.mapLine.deleteMany({ where: { farmId } });
        } else {
          await tx.mapLine.deleteMany({
            where: { farmId, id: { notIn: lineIds } },
          });
        }

        for (const l of safeLines) {
          const id = safeClientId(l?.id);
          const data = l?.data ?? l;
          const name = cleanName(l?.name, "Línea");

          if (id) {
            const up = await tx.mapLine.updateMany({
              where: { id, farmId },
              data: { name, data },
            });
            if (up.count === 0) {
              await tx.mapLine.create({
                data: { id, farmId, name, data },
              });
            }
          } else {
            await tx.mapLine.create({
              data: { farmId, name, data },
            });
          }
        }

        // ----- ZONES -----
        const zoneIds = safeZones
          .map((z) => safeClientId(z?.id))
          .filter(Boolean);

        if (zoneIds.length === 0) {
          await tx.mapZone.deleteMany({ where: { farmId } });
        } else {
          await tx.mapZone.deleteMany({
            where: { farmId, id: { notIn: zoneIds } },
          });
        }

        for (const z of safeZones) {
          const id = safeClientId(z?.id);
          const data = z?.data ?? z;
          const name = cleanName(z?.name, "Zona");
          const components = z?.components ?? null;

          if (id) {
            const up = await tx.mapZone.updateMany({
              where: { id, farmId },
              data: { name, data, components },
            });
            if (up.count === 0) {
              await tx.mapZone.create({
                data: { id, farmId, name, data, components },
              });
            }
          } else {
            await tx.mapZone.create({
              data: { farmId, name, data, components },
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

  // PUT /api/farms/:farmId/zones/:zoneId/components
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
}