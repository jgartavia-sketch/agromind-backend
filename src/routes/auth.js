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
      const { name, email, password, invitationToken } = req.body || {};
      const secret = process.env.JWT_SECRET;

      if (!email || !password) {
        return res.status(400).json({
          error: "Email y password son obligatorios.",
        });
      }

      if (!secret) {
        return res.status(500).json({
          error: "Falta JWT_SECRET en el servidor.",
        });
      }

      const cleanEmail = String(email).trim().toLowerCase();
      const cleanInvitationToken = String(invitationToken || "").trim();

      if (String(password).length < 8) {
        return res.status(400).json({
          error: "La contraseña debe tener al menos 8 caracteres.",
        });
      }

      const existing = await prisma.user.findUnique({
        where: { email: cleanEmail },
        select: { id: true },
      });

      if (existing) {
        return res.status(409).json({
          error: "Ese email ya está registrado.",
        });
      }

      let invitation = null;

      if (cleanInvitationToken) {
        invitation = await prisma.farmInvitation.findFirst({
          where: {
            token: cleanInvitationToken,
            status: "PENDING",
          },
          select: {
            id: true,
            email: true,
            role: true,
            farmId: true,
            farm: {
              select: {
                id: true,
                name: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        });

        if (!invitation) {
          return res.status(400).json({
            error: "La invitación es inválida o ya fue utilizada.",
          });
        }

        if (String(invitation.email).trim().toLowerCase() !== cleanEmail) {
          return res.status(403).json({
            error:
              "Debes registrarte con el mismo correo al que se envió la invitación.",
          });
        }
      }

      const hash = await bcrypt.hash(String(password), 10);

      const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: cleanEmail,
            name: name ? String(name).trim() : null,
            password: hash,
          },
          select: {
            id: true,
            email: true,
            name: true,
            createdAt: true,
          },
        });

        if (invitation) {
          await tx.farmMember.upsert({
            where: {
              userId_farmId: {
                userId: user.id,
                farmId: invitation.farmId,
              },
            },
            update: {
              role: invitation.role,
              status: "ACTIVE",
            },
            create: {
              userId: user.id,
              farmId: invitation.farmId,
              role: invitation.role,
              status: "ACTIVE",
            },
          });

          await tx.farmInvitation.update({
            where: { id: invitation.id },
            data: {
              status: "ACCEPTED",
              acceptedAt: new Date(),
            },
          });

          return {
            user,
            farm: invitation.farm,
            membership: {
              farmId: invitation.farmId,
              role: invitation.role,
              status: "ACTIVE",
            },
            registrationMode: "invitation",
          };
        }

        const farm = await tx.farm.create({
          data: {
            name: "Mi finca",
            userId: user.id,
            view: null,
            preferredCenter: null,
          },
          select: {
            id: true,
            name: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        await tx.farmMember.create({
          data: {
            userId: user.id,
            farmId: farm.id,
            role: "ADMIN",
            status: "ACTIVE",
          },
        });

        return {
          user,
          farm,
          membership: {
            farmId: farm.id,
            role: "ADMIN",
            status: "ACTIVE",
          },
          registrationMode: "standard",
        };
      });

      const token = jwt.sign(
        {
          sub: result.user.id,
          email: result.user.email,
          name: result.user.name || "",
        },
        secret,
        { expiresIn: "7d" }
      );

      return res.status(201).json({
        token,
        user: result.user,
        farm: result.farm,
        membership: result.membership,
        registrationMode: result.registrationMode,
      });
    } catch (err) {
      console.error("REGISTER_ERROR:", err);
      return res.status(500).json({
        error: "Error interno en registro.",
      });
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
        return res.status(400).json({
          error: "Email y password son obligatorios.",
        });
      }

      if (!secret) {
        console.timeEnd(`${loginTraceId} VALIDATIONS`);
        console.timeEnd(`${loginTraceId} TOTAL`);
        return res.status(500).json({
          error: "Falta JWT_SECRET en el servidor.",
        });
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
        return res.status(401).json({
          error: "Credenciales inválidas.",
        });
      }

      console.time(`${loginTraceId} BCRYPT_COMPARE`);

      const ok = await bcrypt.compare(String(password), user.password);

      console.timeEnd(`${loginTraceId} BCRYPT_COMPARE`);

      if (!ok) {
        console.timeEnd(`${loginTraceId} TOTAL`);
        return res.status(401).json({
          error: "Credenciales inválidas.",
        });
      }

      console.time(`${loginTraceId} JWT_SIGN`);

      const token = jwt.sign(
        {
          sub: user.id,
          email: user.email,
          name: user.name || "",
        },
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
      return res.status(500).json({
        error: "Error interno en login.",
      });
    }
  });


  router.post("/login-with-invitation", async (req, res) => {
    try {
      const { email, password, invitationToken } = req.body || {};
      const secret = process.env.JWT_SECRET;

      if (!email || !password || !invitationToken) {
        return res.status(400).json({
          error: "Email, password e invitationToken son obligatorios.",
        });
      }

      if (!secret) {
        return res.status(500).json({
          error: "Falta JWT_SECRET en el servidor.",
        });
      }

      const cleanEmail = String(email).trim().toLowerCase();
      const cleanInvitationToken = String(invitationToken).trim();

      const user = await prisma.user.findUnique({
        where: { email: cleanEmail },
        select: {
          id: true,
          email: true,
          name: true,
          password: true,
        },
      });

      if (!user) {
        return res.status(401).json({
          error: "Credenciales inválidas.",
        });
      }

      const passwordOk = await bcrypt.compare(
        String(password),
        user.password
      );

      if (!passwordOk) {
        return res.status(401).json({
          error: "Credenciales inválidas.",
        });
      }

      const invitation = await prisma.farmInvitation.findFirst({
        where: {
          token: cleanInvitationToken,
          status: "PENDING",
        },
        select: {
          id: true,
          email: true,
          role: true,
          farmId: true,
          expiresAt: true,
          farm: {
            select: {
              id: true,
              name: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      });

      if (!invitation) {
        return res.status(400).json({
          error: "La invitación es inválida o ya fue utilizada.",
        });
      }

      if (
        invitation.expiresAt &&
        new Date(invitation.expiresAt).getTime() <= Date.now()
      ) {
        await prisma.farmInvitation.update({
          where: { id: invitation.id },
          data: {
            status: "EXPIRED",
          },
        });

        return res.status(400).json({
          error: "La invitación ya expiró.",
        });
      }

      if (
        String(invitation.email).trim().toLowerCase() !== cleanEmail
      ) {
        return res.status(403).json({
          error:
            "Debes iniciar sesión con el mismo correo al que se envió la invitación.",
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        const membership = await tx.farmMember.upsert({
          where: {
            userId_farmId: {
              userId: user.id,
              farmId: invitation.farmId,
            },
          },
          update: {
            role: invitation.role,
            status: "ACTIVE",
          },
          create: {
            userId: user.id,
            farmId: invitation.farmId,
            role: invitation.role,
            status: "ACTIVE",
          },
          select: {
            id: true,
            userId: true,
            farmId: true,
            role: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        await tx.farmInvitation.update({
          where: { id: invitation.id },
          data: {
            status: "ACCEPTED",
            acceptedAt: new Date(),
          },
        });

        return {
          membership,
          farm: invitation.farm,
        };
      });

      const token = jwt.sign(
        {
          sub: user.id,
          email: user.email,
          name: user.name || "",
        },
        secret,
        { expiresIn: "7d" }
      );

      return res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        farm: result.farm,
        membership: result.membership,
        registrationMode: "invitation_existing_user",
      });
    } catch (err) {
      console.error("LOGIN_WITH_INVITATION_ERROR:", err);
      return res.status(500).json({
        error: "Error interno aceptando la invitación.",
      });
    }
  });

  router.post("/forgot-password", async (req, res) => {
    try {
      const { email } = req.body || {};

      if (!email) {
        return res.status(400).json({
          error: "El correo es obligatorio.",
        });
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
      return res.status(500).json({
        error: "Error interno al solicitar recuperación.",
      });
    }
  });

  router.post("/reset-password", async (req, res) => {
    try {
      const { token, password } = req.body || {};

      if (!token || !password) {
        return res.status(400).json({
          error: "Token y nueva contraseña son obligatorios.",
        });
      }

      if (String(password).length < 8) {
        return res.status(400).json({
          error: "La contraseña debe tener al menos 8 caracteres.",
        });
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
        return res.status(400).json({
          error: "El enlace es inválido o ya expiró.",
        });
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

      return res.json({
        message: "Contraseña actualizada correctamente.",
      });
    } catch (err) {
      console.error("RESET_PASSWORD_ERROR:", err);
      return res.status(500).json({
        error: "Error interno al actualizar contraseña.",
      });
    }
  });

  router.get("/me", async (req, res) => {
    try {
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

      if (!token) {
        return res.status(401).json({
          error: "Sin token.",
        });
      }

      const secret = process.env.JWT_SECRET;

      if (!secret) {
        return res.status(500).json({
          error: "Falta JWT_SECRET en el servidor.",
        });
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
      return res.status(401).json({
        error: "Token inválido o expirado.",
      });
    }
  });

  return router;
}
