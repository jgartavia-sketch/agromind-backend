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

export default function farmsRouter(prisma) {
  const router = express.Router();

  // =========================
  // GET /api/farms  ✅ (esto faltaba)
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

      const farm = await prisma.farm.create({
        data: {
          userId,
          name: name ? String(name).trim() : "Finca Demo 1",
          view: view ?? { zoom: 14, center: [-84.43, 10.32] },
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
      console.error("CREATE_FARM_ERROR:", err);
      return res.status(500).json({ error: "Error interno creando finca." });
    }
  });

  // helper: verificar que la finca sea del user
  async function assertFarmOwner(farmId, userId) {
    const farm = await prisma.farm.findFirst({
      where: { id: farmId, userId },
      select: { id: true, name: true, view: true, preferredCenter: true },
    });
    return farm;
  }

  // =========================
  // GET /api/farms/:id/map
  // =========================
  router.get("/farms/:id/map", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const userId = req.user.id;

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(404).json({ error: "Finca no existe." });

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

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(404).json({ error: "Finca no existe." });

      const { view, points, lines, zones } = req.body || {};

      const safePoints = Array.isArray(points) ? points : [];
      const safeLines = Array.isArray(lines) ? lines : [];
      const safeZones = Array.isArray(zones) ? zones : [];

      // Transacción: borramos y reinsertamos (simple y confiable para demo/propuesta)
      // Luego optimizamos a upsert incremental.
      const result = await prisma.$transaction(async (tx) => {
        if (view) {
          await tx.farm.update({
            where: { id: farmId },
            data: { view },
          });
        }

        await tx.mapPoint.deleteMany({ where: { farmId } });
        await tx.mapLine.deleteMany({ where: { farmId } });
        await tx.mapZone.deleteMany({ where: { farmId } });

        if (safePoints.length > 0) {
          await tx.mapPoint.createMany({
            data: safePoints.map((p) => ({
              farmId,
              name: String(p.name || "").trim() || "Punto",
              data: p.data ?? p,
            })),
          });
        }

        if (safeLines.length > 0) {
          await tx.mapLine.createMany({
            data: safeLines.map((l) => ({
              farmId,
              name: String(l.name || "").trim() || "Línea",
              data: l.data ?? l,
            })),
          });
        }

        if (safeZones.length > 0) {
          // createMany NO soporta JSON arrays complejo igual en todos los casos; lo hacemos uno por uno.
          for (const z of safeZones) {
            await tx.mapZone.create({
              data: {
                farmId,
                name: String(z.name || "").trim() || "Zona",
                data: z.data ?? z,
                components: z.components ?? {},
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
