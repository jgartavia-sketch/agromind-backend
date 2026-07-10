// src/routes/bitacora.js
import express from "express";

export default function bitacoraRouter(prisma) {
  const router = express.Router();

  router.get("/farms/:farmId/bitacora", async (req, res) => {
    try {
      const { farmId } = req.params;

      const entries = await prisma.bitacoraEntry.findMany({
        where: { farmId },
        orderBy: {
          createdAt: "desc",
        },
      });

      return res.json(entries);
    } catch (e) {
      return res.status(500).json({
        error: "Error obteniendo bitácora.",
        details: String(e?.message || e),
      });
    }
  });

  router.post("/farms/:farmId/bitacora", async (req, res) => {
    try {
      const { farmId } = req.params;
      const { text, insights } = req.body || {};

      const cleanText = String(text || "").trim();

      if (!cleanText) {
        return res.status(400).json({
          error: "Texto requerido.",
        });
      }

      const entry = await prisma.bitacoraEntry.create({
        data: {
          farmId,
          text: cleanText,
          insights: insights || null,
        },
      });

      return res.status(201).json(entry);
    } catch (e) {
      return res.status(500).json({
        error: "Error creando entrada de bitácora.",
        details: String(e?.message || e),
      });
    }
  });

  router.patch("/farms/:farmId/bitacora/:entryId", async (req, res) => {
    try {
      const { farmId, entryId } = req.params;
      const cleanText = String(req.body?.text || "").trim();

      if (!cleanText) {
        return res.status(400).json({
          error: "Texto requerido.",
        });
      }

      const existingEntry = await prisma.bitacoraEntry.findFirst({
        where: {
          id: entryId,
          farmId,
        },
      });

      if (!existingEntry) {
        return res.status(404).json({
          error: "Nota no encontrada.",
        });
      }

      const updatedEntry = await prisma.bitacoraEntry.update({
        where: { id: entryId },
        data: {
          text: cleanText,
        },
      });

      return res.json(updatedEntry);
    } catch (e) {
      return res.status(500).json({
        error: "Error actualizando entrada de bitácora.",
        details: String(e?.message || e),
      });
    }
  });

  router.delete("/farms/:farmId/bitacora/:entryId", async (req, res) => {
    try {
      const { farmId, entryId } = req.params;

      const existingEntry = await prisma.bitacoraEntry.findFirst({
        where: {
          id: entryId,
          farmId,
        },
      });

      if (!existingEntry) {
        return res.status(404).json({
          error: "Nota no encontrada.",
        });
      }

      await prisma.bitacoraEntry.delete({
        where: { id: entryId },
      });

      return res.json({
        ok: true,
        id: entryId,
      });
    } catch (e) {
      return res.status(500).json({
        error: "Error eliminando entrada de bitácora.",
        details: String(e?.message || e),
      });
    }
  });

  return router;
}
