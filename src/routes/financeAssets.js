import express from "express";
import pkg from "@prisma/client";
const { PrismaClient } = pkg;

const router = express.Router();
const prisma = new PrismaClient();

/**
 * IMPORTANTE:
 * Este router asume que YA tienes un middleware requireAuth
 * que deja el usuario en req.user (ej: req.user.id).
 * Úsalo igual que lo usas en movimientos.
 */

// Helper: valida que la finca le pertenezca al usuario
async function assertFarmOwnership({ farmId, userId }) {
  const farm = await prisma.farm.findFirst({
    where: { id: farmId, userId },
    select: { id: true },
  });
  return !!farm;
}

// GET /api/farms/:farmId/finance/assets
router.get("/farms/:farmId/finance/assets", async (req, res) => {
  try {
    const { farmId } = req.params;
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: "No autorizado" });

    const ok = await assertFarmOwnership({ farmId, userId });
    if (!ok) return res.status(403).json({ error: "Sin acceso a la finca" });

    const assets = await prisma.financeAsset.findMany({
      where: { farmId },
      orderBy: { createdAt: "desc" },
    });

    res.json({ assets });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Error al listar activos" });
  }
});

// POST /api/farms/:farmId/finance/assets
router.post("/farms/:farmId/finance/assets", async (req, res) => {
  try {
    const { farmId } = req.params;
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: "No autorizado" });

    const ok = await assertFarmOwnership({ farmId, userId });
    if (!ok) return res.status(403).json({ error: "Sin acceso a la finca" });

    const { name, type, qty, unitValue } = req.body || {};

    const cleanName = String(name || "").trim();
    if (!cleanName) return res.status(400).json({ error: "Nombre requerido" });

    const created = await prisma.financeAsset.create({
      data: {
        farmId,
        name: cleanName,
        type: String(type || "Equipo"),
        qty: Math.max(1, Number(qty || 1)),
        unitValue: Math.max(0, Math.trunc(Number(unitValue || 0))),
      },
    });

    res.json({ asset: created });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Error al crear activo" });
  }
});

// PUT /api/farms/:farmId/finance/assets/:assetId
router.put("/farms/:farmId/finance/assets/:assetId", async (req, res) => {
  try {
    const { farmId, assetId } = req.params;
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: "No autorizado" });

    const ok = await assertFarmOwnership({ farmId, userId });
    if (!ok) return res.status(403).json({ error: "Sin acceso a la finca" });

    const { name, type, qty, unitValue } = req.body || {};

    const existing = await prisma.financeAsset.findFirst({
      where: { id: assetId, farmId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: "Activo no existe" });

    const updated = await prisma.financeAsset.update({
      where: { id: assetId },
      data: {
        ...(name !== undefined ? { name: String(name || "").trim() } : {}),
        ...(type !== undefined ? { type: String(type || "Equipo") } : {}),
        ...(qty !== undefined ? { qty: Math.max(1, Number(qty || 1)) } : {}),
        ...(unitValue !== undefined
          ? { unitValue: Math.max(0, Math.trunc(Number(unitValue || 0))) }
          : {}),
      },
    });

    res.json({ asset: updated });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Error al actualizar activo" });
  }
});

// DELETE /api/farms/:farmId/finance/assets/:assetId
router.delete("/farms/:farmId/finance/assets/:assetId", async (req, res) => {
  try {
    const { farmId, assetId } = req.params;
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: "No autorizado" });

    const ok = await assertFarmOwnership({ farmId, userId });
    if (!ok) return res.status(403).json({ error: "Sin acceso a la finca" });

    const existing = await prisma.financeAsset.findFirst({
      where: { id: assetId, farmId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: "Activo no existe" });

    await prisma.financeAsset.delete({ where: { id: assetId } });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Error al borrar activo" });
  }
});

export default router;