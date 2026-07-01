// src/routes/auth.js
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { sendEmail } from "../services/emailService.js";

export default function authRouter(prisma) {
  const router = express.Router();

  const buildFrontendUrl = () => {
    const raw =
      process.env.FRONTEND_URL ||
      process.env.CLIENT_URL ||
      "https://www.agromindcr.es";

    return String(raw).replace(/\/+$/, "");
  };

  router.post("/register", async (req, res) => {
    try {
      const { name, email, password } = req.body || {};
      const secret = process.env.JWT_SECRET;

      if (!email || !password) {
        return res.status(400).json({ error: "Email y password son obligatorios." });
      }

      if (!secret) {
        return res.status(500).json({ error: "Falta JWT_SECRET en el servidor." });
      }

      const cleanEmail = String(email).trim().toLowerCase();

      if (String(password).length < 8) {
        return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres." });
      }

      const existing = await prisma.user.findUnique({
        where: { email: cleanEmail },
        select: { id: true },
      });

      if (existing) {
        return res.status(409).json({ error: "Ese email ya está registrado." });
      }

      const hash = await bcrypt.hash(String(password), 10);

      const { user, farm } = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: cleanEmail,
            name: name ? String(name).trim() : null,
            password: hash,
          },
          select: { id: true, email: true, name: true, createdAt: true },
        });

        const farm = await tx.farm.create({
          data: {
            name: "Mi finca",
            userId: user.id,
            view: null,
            preferredCenter: null,
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

  router.post("/login", async (req, res) => {
    const loginTraceId = `LOGIN_TRACE_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    console.time(`${loginTraceId} TOTAL`);

    try {
      console.time(`${loginTraceId} VALIDATIONS`);

      const { email, password } = req.body || {};
      const secret = process.env.JWT_SECRET;

      if (!email || !password) {
        console.timeEnd(`${loginTraceId} VALIDATIONS`);
        console.timeEnd(`${loginTraceId} TOTAL`);
        return res.status(400).json({ error: "Email y password son obligatorios." });
      }

      if (!secret) {
        console.timeEnd(`${loginTraceId} VALIDATIONS`);
        console.timeEnd(`${loginTraceId} TOTAL`);
        return res.status(500).json({ error: "Falta JWT_SECRET en el servidor." });
      }

      const cleanEmail = String(email).trim().toLowerCase();

      console.timeEnd(`${loginTraceId} VALIDATIONS`);

      console.time(`${loginTraceId} PRISMA_FIND_USER`);

      const user = await prisma.user.findUnique({
        where: { email: cleanEmail },
        select: {
          id: true,
          email: true,
          name: true,
          password: true,
        },
      });

      console.timeEnd(`${loginTraceId} PRISMA_FIND_USER`);

      if (!user) {
        console.timeEnd(`${loginTraceId} TOTAL`);
        return res.status(401).json({ error: "Credenciales inválidas." });
      }

      console.time(`${loginTraceId} BCRYPT_COMPARE`);

      const ok = await bcrypt.compare(String(password), user.password);

      console.timeEnd(`${loginTraceId} BCRYPT_COMPARE`);

      if (!ok) {
        console.timeEnd(`${loginTraceId} TOTAL`);
        return res.status(401).json({ error: "Credenciales inválidas." });
      }

      console.time(`${loginTraceId} JWT_SIGN`);

      const token = jwt.sign(
        { sub: user.id, email: user.email, name: user.name || "" },
        secret,
        { expiresIn: "7d" }
      );

      console.timeEnd(`${loginTraceId} JWT_SIGN`);

      console.time(`${loginTraceId} RESPONSE_JSON`);

      const response = res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      });

      console.timeEnd(`${loginTraceId} RESPONSE_JSON`);
      console.timeEnd(`${loginTraceId} TOTAL`);

      return response;
    } catch (err) {
      console.error("LOGIN_ERROR:", err);
      console.timeEnd(`${loginTraceId} TOTAL`);
      return res.status(500).json({ error: "Error interno en login." });
    }
  });

  router.post("/forgot-password", async (req, res) => {
    try {
      const { email } = req.body || {};

      if (!email) {
        return res.status(400).json({ error: "El correo es obligatorio." });
      }

      const cleanEmail = String(email).trim().toLowerCase();

      const user = await prisma.user.findUnique({
        where: { email: cleanEmail },
        select: {
          id: true,
          email: true,
          name: true,
        },
      });

      const genericMessage =
        "Si el correo está registrado, recibirás instrucciones para recuperar tu contraseña.";

      if (!user) {
        return res.json({ message: genericMessage });
      }

      const resetToken = crypto.randomBytes(32).toString("hex");
      const resetExpires = new Date(Date.now() + 1000 * 60 * 30);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetPasswordToken: resetToken,
          resetPasswordExpires: resetExpires,
        },
      });

      const frontendUrl = buildFrontendUrl();
      const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

      await sendEmail({
        to: user.email,
        subject: "Recuperar contraseña - AgroMind CR",
        text: `Hola ${
          user.name || "Productor"
        }, usa este enlace para recuperar tu contraseña: ${resetUrl}. Este enlace vence en 30 minutos.`,
        html: `
          <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
            <h2 style="margin-bottom: 8px;">AgroMind CR</h2>
            <p>Hola ${user.name || "Productor"},</p>
            <p>Recibimos una solicitud para recuperar tu contraseña.</p>
            <p>
              Haz clic en el siguiente botón para crear una nueva contraseña:
            </p>
            <p style="margin: 24px 0;">
              <a
                href="${resetUrl}"
                target="_blank"
                rel="noreferrer"
                style="background: #1f7a3f; color: #ffffff; padding: 12px 18px; text-decoration: none; border-radius: 10px; font-weight: bold;"
              >
                Recuperar contraseña
              </a>
            </p>
            <p>Este enlace vence en 30 minutos.</p>
            <p>Si no solicitaste este cambio, puedes ignorar este correo.</p>
          </div>
        `,
      });

      return res.json({ message: genericMessage });
    } catch (err) {
      console.error("FORGOT_PASSWORD_ERROR:", err);
      return res.status(500).json({ error: "Error interno al solicitar recuperación." });
    }
  });

  router.post("/reset-password", async (req, res) => {
    try {
      const { token, password } = req.body || {};

      if (!token || !password) {
        return res.status(400).json({ error: "Token y nueva contraseña son obligatorios." });
      }

      if (String(password).length < 8) {
        return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres." });
      }

      const user = await prisma.user.findFirst({
        where: {
          resetPasswordToken: String(token).trim(),
          resetPasswordExpires: {
            gt: new Date(),
          },
        },
        select: {
          id: true,
        },
      });

      if (!user) {
        return res.status(400).json({ error: "El enlace es inválido o ya expiró." });
      }

      const hash = await bcrypt.hash(String(password), 10);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          password: hash,
          resetPasswordToken: null,
          resetPasswordExpires: null,
        },
      });

      return res.json({ message: "Contraseña actualizada correctamente." });
    } catch (err) {
      console.error("RESET_PASSWORD_ERROR:", err);
      return res.status(500).json({ error: "Error interno al actualizar contraseña." });
    }
  });

  router.get("/me", async (req, res) => {
    try {
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

      if (!token) {
        return res.status(401).json({ error: "Sin token." });
      }

      const secret = process.env.JWT_SECRET;

      if (!secret) {
        return res.status(500).json({ error: "Falta JWT_SECRET en el servidor." });
      }

      const payload = jwt.verify(token, secret);

      return res.json({
        user: {
          id: payload.sub,
          email: payload.email,
          name: payload.name || null,
        },
      });
    } catch (err) {
      return res.status(401).json({ error: "Token inválido o expirado." });
    }
  });

  return router;
}