// src/routes/bitacora.js
import express from "express";

export default function bitacoraRouter(prisma) {
  const router = express.Router();

  // =========================
  // GET ENTRIES
  // =========================
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

  // =========================
  // CREATE ENTRY
  // =========================
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

  return router;
}