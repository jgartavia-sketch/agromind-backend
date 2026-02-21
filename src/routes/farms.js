// src/routes/farms.js
import express from "express";
import jwt from "jsonwebtoken";

function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Sin token." });

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: "Falta JWT_SECRET en el servidor." });

    const payload = jwt.verify(token, secret);
    if (!payload?.sub) return res.status(401).json({ error: "Token inválido." });

    req.user = { id: payload.sub, email: payload.email || "", name: payload.name || "" };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado." });
  }
}

// helpers chicos
function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function cleanName(v, fallback) {
  const s = isNonEmptyString(v) ? v.trim() : "";
  return s.length ? s.slice(0, 80) : fallback; // evita nombres kilométricos
}

function looksLikeId(v) {
  // cuid suele ser largo, pero esto evita ids vacíos/raros sin sobrecomplicar
  return isNonEmptyString(v) && v.trim().length >= 8;
}

export default function farmsRouter(prisma) {
  const router = express.Router();

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

      const finalName = cleanName(name, "Finca Demo 1");

      const finalView =
        view ?? { zoom: 14, center: [-84.43, 10.32] };

      const preferredCenter =
        finalView && Array.isArray(finalView.center) ? finalView.center : null;

      const farm = await prisma.farm.create({
        data: {
          userId,
          name: finalName,
          view: finalView,
          preferredCenter,
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
      // Si pega el unique (userId,name) lo devolvemos bonito
      if (err?.code === "P2002") {
        return res.status(409).json({ error: "Ya existe una finca con ese nombre." });
      }
      console.error("CREATE_FARM_ERROR:", err);
      return res.status(500).json({ error: "Error interno creando finca." });
    }
  });

  // helper: verificar que la finca sea del user
  async function assertFarmOwner(farmId, userId) {
    return prisma.farm.findFirst({
      where: { id: farmId, userId },
      select: { id: true, name: true, view: true, preferredCenter: true },
    });
  }

  // =========================
  // GET /api/farms/:id/map
  // =========================
  router.get("/farms/:id/map", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const userId = req.user.id;

      if (!looksLikeId(farmId)) return res.status(400).json({ error: "farmId inválido." });

      const farm = await assertFarmOwner(farmId, userId);
      // 403 para no revelar si existe o no cuando no es del usuario
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

      if (!looksLikeId(farmId)) return res.status(400).json({ error: "farmId inválido." });

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const { view, points, lines, zones } = req.body || {};

      const safePoints = Array.isArray(points) ? points : [];
      const safeLines = Array.isArray(lines) ? lines : [];
      const safeZones = Array.isArray(zones) ? zones : [];

      // Transacción: borramos y reinsertamos (simple y confiable para demo/propuesta)
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
          saved: { points: safePoints.length, lines: safeLines.length, zones: safeZones.length },
        };
      });

      return res.json(result);
    } catch (err) {
      console.error("PUT_MAP_ERROR:", err);
      return res.status(500).json({ error: "Error interno guardando mapa." });
    }
  });

  return router;
}