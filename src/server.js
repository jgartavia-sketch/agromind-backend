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

dotenv.config();

const app = express();
app.set("trust proxy", 1);

app.use(express.json());

// =========================
// CORS (PRODUCCIÓN-READY)
// =========================
const ALLOWED_ORIGINS = [
  "https://www.agromindcr.es",
  "https://agromindcr.es",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const isVercelPreview = (origin = "") =>
  origin.endsWith(".vercel.app") || origin.includes(".vercel.app");

app.use(
  cors({
    origin: (origin, cb) => {
      // Requests sin Origin (Thunder/Postman/server-to-server) → permitir
      if (!origin) return cb(null, true);

      if (ALLOWED_ORIGINS.includes(origin) || isVercelPreview(origin)) {
        return cb(null, true);
      }

      return cb(new Error(`CORS bloqueado para origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Preflight explícito
app.options("*", cors());

// =========================
// Prisma / DB
// =========================
if (!process.env.DATABASE_URL) {
  throw new Error("Falta DATABASE_URL en .env");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// =========================
// DIAGNÓSTICO (para Render)
// =========================
app.get("/__version", (req, res) => {
  res.json({
    ok: true,
    env: process.env.NODE_ENV || "unknown",
    time: new Date().toISOString(),
  });
});

// Lista rutas montadas (sirve para confirmar /api/farms en Render)
app.get("/__routes", (req, res) => {
  const routes = [];
  const stack = app?._router?.stack || [];
  stack.forEach((layer) => {
    if (layer.route?.path) {
      const methods = Object.keys(layer.route.methods || {}).map((m) => m.toUpperCase());
      routes.push({ path: layer.route.path, methods });
    }
  });
  res.json({ routes });
});

// =========================
// RUTAS
// =========================
app.get("/", (req, res) => {
  res.json({ message: "AgroMind Backend running 🚀" });
});

// AUTH
app.use("/auth", authRouter(prisma));

// API (Mapa / Fincas)
app.use("/api", farmsRouter(prisma));

// =========================
// ARRANQUE
// =========================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ API listening on port ${PORT}`);
});
