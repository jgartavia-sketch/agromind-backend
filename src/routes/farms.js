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

export default function farmsRouter(prisma) {
  const router = express.Router();

  async function assertFarmOwner(farmId, userId) {
    return prisma.farm.findFirst({
      where: { id: farmId, userId },
      select: { id: true },
    });
  }

  async function assertZoneOwner(zoneId, farmId) {
    return prisma.mapZone.findFirst({
      where: { id: zoneId, farmId },
      select: { id: true },
    });
  }

  // =========================
  // NUEVO ENDPOINT PROFESIONAL
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
          select: {
            id: true,
            name: true,
            components: true,
            updatedAt: true,
          },
        });

        return res.json({ ok: true, zone: updatedZone });
      } catch (err) {
        console.error("UPDATE_COMPONENTS_ERROR:", err);
        return res.status(500).json({ error: "Error guardando componentes." });
      }
    }
  );

  return router;
}