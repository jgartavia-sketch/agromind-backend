// src/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import pkg from "@prisma/client";
const { PrismaClient } = pkg;

import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

import authRouter from "./routes/auth.js";
import farmsRouter from "./routes/farms.js";
import processesRouter from "./routes/processes.js";
import bitacoraRouter from "./routes/bitacora.js";

import { verifyEmailTransport } from "./services/emailService.js";
import { sendDueTomorrowTaskReminders } from "./services/taskReminderService.js";

dotenv.config();

const app = express();
app.set("trust proxy", 1);

app.use(express.json({ limit: "15mb" }));

const ALLOWED_ORIGINS = [
  "https://www.agromindcr.es",
  "https://agromindcr.es",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const isVercelPreview = (origin = "") =>
  origin.endsWith(".vercel.app") || origin.includes(".vercel.app");

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);

    if (ALLOWED_ORIGINS.includes(origin) || isVercelPreview(origin)) {
      return cb(null, true);
    }

    return cb(new Error(`CORS bloqueado para origin: ${origin}`));
  },

  credentials: false,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-admin-alerts-key"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.get("/__cors", (req, res) => {
  res.json({
    ok: true,
    origin: req.headers.origin || null,
    allowedOrigins: ALLOWED_ORIGINS,
    isVercelPreview: isVercelPreview(req.headers.origin || ""),
    time: new Date().toISOString(),
  });
});

app.use((err, req, res, next) => {
  if (err && String(err.message || "").startsWith("CORS bloqueado")) {
    return res.status(403).json({ error: err.message });
  }
  return next(err);
});

if (!process.env.DATABASE_URL) {
  throw new Error("Falta DATABASE_URL en .env");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function safeBool(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function extractJsonFromText(text = "") {
  const s = String(text || "").trim();
  if (!s) return null;

  if (s.startsWith("{") && s.endsWith("}")) {
    try {
      return JSON.parse(s);
    } catch (_) {}
  }

  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    const candidate = s.slice(first, last + 1);
    try {
      return JSON.parse(candidate);
    } catch (_) {
      return null;
    }
  }

  return null;
}

function normalizeDataUrl(dataUrl = "") {
  const v = String(dataUrl || "").trim();
  if (!v.startsWith("data:image/")) return null;
  if (!v.includes(";base64,")) return null;
  return v;
}

async function callOpenAIForInvestigation({
  imageDataUrl,
  farmId,
  zoneName,
  extraContext,
}) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      status: 500,
      error:
        "Falta OPENAI_API_KEY en el .env del backend (no la pongas en el frontend).",
    };
  }

  const model = process.env.OPENAI_MODEL_INVESTIGATOR || "gpt-4.1-mini";

  const instructions =
    "Eres un asistente técnico para fincas (agronomía + manejo básico de animales). " +
    "Analiza UNA imagen y devuelve SOLO JSON (sin texto extra). " +
    "No inventes datos; si no estás seguro, dilo. " +
    "No des dosis de medicamentos ni instrucciones peligrosas; sugiere consultar un profesional cuando sea urgente.";

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      category: { type: "string", enum: ["plant", "animal", "unknown"] },
      likely_subject: { type: "string" },
      likely_species_or_type: { type: "string" },
      issue: { type: "string" },
      severity: { type: "string", enum: ["low", "medium", "high"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      key_observations: { type: "array", items: { type: "string" } },
      recommended_actions: { type: "array", items: { type: "string" } },
      questions_to_confirm: { type: "array", items: { type: "string" } },
      urgency: { type: "string", enum: ["none", "soon", "urgent"] },
      economic_hint: { type: "string" },
    },
    required: [
      "category",
      "likely_subject",
      "likely_species_or_type",
      "issue",
      "severity",
      "confidence",
      "key_observations",
      "recommended_actions",
      "questions_to_confirm",
      "urgency",
      "economic_hint",
    ],
  };

  const userText =
    `Contexto AgroMind:\n` +
    `- farmId: ${farmId || "N/A"}\n` +
    `- zona: ${zoneName || "N/A"}\n` +
    (extraContext ? `- notas: ${extraContext}\n` : "") +
    `\nTarea:\nAnaliza la imagen y devuelve el JSON con el esquema solicitado.`;

  const body = {
    model,
    instructions,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: userText },
          { type: "input_image", image_url: imageDataUrl },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "investigation_result",
        schema,
        strict: true,
      },
    },
  };

  let resp;
  try {
    resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return {
      ok: false,
      status: 502,
      error: "No se pudo conectar con OpenAI (network).",
      details: String(e?.message || e),
    };
  }

  if (!resp.ok) {
    let errText = "";
    try {
      errText = await resp.text();
    } catch (_) {}
    return {
      ok: false,
      status: resp.status,
      error: "OpenAI respondió con error.",
      details: errText?.slice(0, 1200) || "",
    };
  }

  const data = await resp.json();

  const outputText =
    data?.output_text ||
    (Array.isArray(data?.output)
      ? data.output
          .map((o) => {
            const c = o?.content;
            if (!Array.isArray(c)) return "";
            return c
              .map((p) => (p?.type === "output_text" ? p?.text : ""))
              .filter(Boolean)
              .join("\n");
          })
          .filter(Boolean)
          .join("\n")
      : "");

  const parsed = extractJsonFromText(outputText);

  if (!parsed) {
    return {
      ok: false,
      status: 500,
      error:
        "La IA respondió, pero no devolvió JSON parseable. (Te devuelvo el texto para debug).",
      details: String(outputText || "").slice(0, 2000),
    };
  }

  return { ok: true, status: 200, result: parsed };
}

function requireAdminAlertsKey(req, res, next) {
  const expected = String(process.env.ADMIN_ALERTS_KEY || "").trim();

  if (!expected) {
    return res.status(500).json({
      error:
        "Falta ADMIN_ALERTS_KEY en el .env del backend. No se puede usar esta ruta todavía.",
    });
  }

  const received = String(req.headers["x-admin-alerts-key"] || "").trim();

  if (!received || received !== expected) {
    return res.status(401).json({ error: "No autorizado." });
  }

  return next();
}

app.get("/__version", (req, res) => {
  res.json({
    ok: true,
    env: process.env.NODE_ENV || "unknown",
    time: new Date().toISOString(),
  });
});

app.get("/__routes", (req, res) => {
  const routes = [];
  const stack = app?._router?.stack || [];
  stack.forEach((layer) => {
    if (layer.route?.path) {
      const methods = Object.keys(layer.route.methods || {}).map((m) =>
        m.toUpperCase()
      );
      routes.push({ path: layer.route.path, methods });
    }
  });
  res.json({ routes });
});

app.get("/", (req, res) => {
  res.json({ message: "AgroMind Backend running 🚀" });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    hasOpenAIKey: safeBool(!!process.env.OPENAI_API_KEY),
    hasEmailUser: safeBool(!!process.env.EMAIL_USER),
    hasEmailPass: safeBool(!!process.env.EMAIL_PASS),
  });
});

app.use("/auth", authRouter(prisma));
app.use("/api", farmsRouter(prisma));
app.use("/api", bitacoraRouter(prisma));
app.use("/api/processes", processesRouter(prisma));

app.post(
  "/api/admin/run-task-reminders",
  requireAdminAlertsKey,
  async (req, res) => {
    try {
      const result = await sendDueTomorrowTaskReminders(prisma);

      return res.json({
        ok: true,
        message: "Proceso de recordatorios ejecutado.",
        ...result,
      });
    } catch (e) {
      return res.status(500).json({
        error: "Error ejecutando recordatorios.",
        details: String(e?.message || e),
      });
    }
  }
);

app.get("/api/admin/email-status", requireAdminAlertsKey, async (req, res) => {
  try {
    await verifyEmailTransport();
    return res.json({
      ok: true,
      message: "Servicio de email listo.",
    });
  } catch (e) {
    return res.status(500).json({
      error: "Servicio de email no disponible.",
      details: String(e?.message || e),
    });
  }
});

app.post("/api/investigator/analyze", async (req, res) => {
  try {
    const { farmId, zoneName, imageDataUrl, extraContext } = req.body || {};

    if (!farmId) {
      return res.status(400).json({ error: "farmId es requerido." });
    }

    const normalized = normalizeDataUrl(imageDataUrl);
    if (!normalized) {
      return res.status(400).json({
        error:
          "imageDataUrl inválido. Debe ser un data URL base64 tipo: data:image/jpeg;base64,....",
      });
    }

    const out = await callOpenAIForInvestigation({
      imageDataUrl: normalized,
      farmId,
      zoneName,
      extraContext,
    });

    if (!out.ok) {
      return res.status(out.status || 500).json({
        error: out.error || "Error en Investigador IA.",
        details: out.details || undefined,
      });
    }

    return res.json({
      ok: true,
      farmId,
      zoneName: zoneName || null,
      result: out.result,
    });
  } catch (e) {
    return res.status(500).json({
      error: "Error inesperado en /api/investigator/analyze",
      details: String(e?.message || e),
    });
  }
});

const PORT = Number(process.env.PORT) || 3001;
const HOST = "0.0.0.0";

app.listen(PORT, HOST, async () => {
  console.log(`✅ API listening on http://${HOST}:${PORT}`);
  console.log(`🌱 AgroMind backend listo en puerto ${PORT}`);

  try {
    await verifyEmailTransport();
  } catch (e) {
    console.error(
      "⚠️ Email no verificado al arrancar:",
      String(e?.message || e)
    );
  }
});