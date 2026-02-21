// src/routes/auth.js
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

export default function authRouter(prisma) {
  const router = express.Router();

  // POST /auth/register
  router.post("/register", async (req, res) => {
    try {
      const { name, email, password } = req.body || {};

      if (!email || !password) {
        return res
          .status(400)
          .json({ error: "Email y password son obligatorios." });
      }

      const secret = process.env.JWT_SECRET;
      if (!secret) {
        return res
          .status(500)
          .json({ error: "Falta JWT_SECRET en el servidor." });
      }

      const cleanEmail = String(email).trim().toLowerCase();

      if (String(password).length < 8) {
        return res
          .status(400)
          .json({ error: "La contraseña debe tener al menos 8 caracteres." });
      }

      const existing = await prisma.user.findUnique({
        where: { email: cleanEmail },
        select: { id: true },
      });

      if (existing) {
        return res.status(409).json({ error: "Ese email ya está registrado." });
      }

      const hash = await bcrypt.hash(String(password), 10);

      // ✅ User + Farm en una sola transacción (atomicidad)
      const { user, farm } = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: cleanEmail,
            name: name ? String(name).trim() : null,
            password: hash,
          },
          select: { id: true, email: true, name: true, createdAt: true },
        });

        // ✅ Crear finca real para ese usuario (NO demo)
        const farm = await tx.farm.create({
          data: {
            name: "Mi finca",
            userId: user.id, // 👈 si tu schema usa otro nombre (ownerId), lo cambiamos
            view: null,
            preferredCenter: null, // si tu modelo no tiene esto, bórralo
          },
          select: { id: true, name: true, createdAt: true, updatedAt: true },
        });

        return { user, farm };
      });

      const token = jwt.sign(
        { sub: user.id, email: user.email, name: user.name || "" },
        secret,
        { expiresIn: "7d" }
      );

      return res.status(201).json({ token, user, farm });
    } catch (err) {
      console.error("REGISTER_ERROR:", err);
      return res.status(500).json({ error: "Error interno en registro." });
    }
  });

  // POST /auth/login
  router.post("/login", async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) {
        return res
          .status(400)
          .json({ error: "Email y password son obligatorios." });
      }

      const cleanEmail = String(email).trim().toLowerCase();

      const user = await prisma.user.findUnique({
        where: { email: cleanEmail },
      });

      if (!user) {
        return res.status(401).json({ error: "Credenciales inválidas." });
      }

      const ok = await bcrypt.compare(String(password), user.password);
      if (!ok) {
        return res.status(401).json({ error: "Credenciales inválidas." });
      }

      const secret = process.env.JWT_SECRET;
      if (!secret) {
        return res
          .status(500)
          .json({ error: "Falta JWT_SECRET en el servidor." });
      }

      const token = jwt.sign(
        { sub: user.id, email: user.email, name: user.name || "" },
        secret,
        { expiresIn: "7d" }
      );

      return res.json({
        token,
        user: { id: user.id, email: user.email, name: user.name },
      });
    } catch (err) {
      console.error("LOGIN_ERROR:", err);
      return res.status(500).json({ error: "Error interno en login." });
    }
  });

  // GET /auth/me (requiere Bearer token)
  router.get("/me", async (req, res) => {
    try {
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

      if (!token) return res.status(401).json({ error: "Sin token." });

      const secret = process.env.JWT_SECRET;
      if (!secret) {
        return res
          .status(500)
          .json({ error: "Falta JWT_SECRET en el servidor." });
      }

      const payload = jwt.verify(token, secret);
      const userId = payload?.sub;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, createdAt: true },
      });

      if (!user) return res.status(404).json({ error: "Usuario no existe." });

      return res.json({ user });
    } catch (err) {
      return res.status(401).json({ error: "Token inválido o expirado." });
    }
  });

  return router;
}