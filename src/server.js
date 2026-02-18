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
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

if (!process.env.DATABASE_URL) {
  throw new Error("Falta DATABASE_URL en .env");
}

// ✅ Pool de Postgres (Render) con SSL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Prisma con Adapter (Prisma 7)
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// RUTAS
app.get("/", (req, res) => {
  res.json({ message: "AgroMind Backend running 🚀" });
});

// AUTH
app.use("/auth", authRouter(prisma));

// API (Mapa / Fincas)
app.use("/api", farmsRouter(prisma));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ http://localhost:${PORT}`));
