// src/routes/farmInvitations.js

import express from "express";
import crypto from "crypto";
import { requireAuth } from "./farms.base.js";
import { assertFarmAdmin } from "../services/farmAccess.js";
import { sendEmail } from "../services/emailService.js";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getFrontendBaseUrl() {
  return (
    String(process.env.FRONTEND_URL || "").trim().replace(/\/+$/, "") ||
    "https://www.agromindcr.es"
  );
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildInvitationEmail({ farmName, invitationToken }) {
  const safeFarmName = escapeHtml(farmName || "una finca");
  const acceptanceUrl = `${getFrontendBaseUrl()}/invitations/accept?token=${encodeURIComponent(
    invitationToken
  )}`;

  const subject = `Invitación para colaborar en ${farmName || "AgroMind CR"}`;

  const text = [
    "Has sido invitado como Consultor en AgroMind CR.",
    "",
    `Finca: ${farmName || "Finca AgroMind"}`,
    "Rol: Consultor",
    "",
    "Podrás consultar el mapa, zonas, puntos, líneas, tareas, procesos y clima.",
    "No tendrás acceso a finanzas, reportes, dashboard, configuración ni edición administrativa.",
    "",
    `Aceptar invitación: ${acceptanceUrl}`,
    "",
    "Si no esperabas esta invitación, puedes ignorar este correo.",
  ].join("\n");

  const html = `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(subject)}</title>
      </head>

      <body style="margin: 0; padding: 0; background: #020617;">
        <table
          role="presentation"
          width="100%"
          cellspacing="0"
          cellpadding="0"
          border="0"
          style="width: 100%; background: #020617; padding: 28px 12px;"
        >
          <tr>
            <td align="center">
              <table
                role="presentation"
                width="100%"
                cellspacing="0"
                cellpadding="0"
                border="0"
                style="
                  width: 100%;
                  max-width: 620px;
                  overflow: hidden;
                  border: 1px solid rgba(45, 212, 191, 0.28);
                  border-radius: 20px;
                  background: #0f172a;
                  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.35);
                "
              >
                <tr>
                  <td
                    style="
                      padding: 30px 30px 22px;
                      background:
                        linear-gradient(135deg, rgba(20, 184, 166, 0.18), rgba(15, 23, 42, 0.98));
                    "
                  >
                    <p
                      style="
                        margin: 0 0 8px;
                        color: #5eead4;
                        font-family: Arial, sans-serif;
                        font-size: 12px;
                        font-weight: 700;
                        letter-spacing: 1.4px;
                        text-transform: uppercase;
                      "
                    >
                      AgroMind CR
                    </p>

                    <h1
                      style="
                        margin: 0;
                        color: #f8fafc;
                        font-family: Arial, sans-serif;
                        font-size: 28px;
                        line-height: 1.2;
                      "
                    >
                      Invitación para colaborar
                    </h1>

                    <p
                      style="
                        margin: 14px 0 0;
                        color: #cbd5e1;
                        font-family: Arial, sans-serif;
                        font-size: 16px;
                        line-height: 1.7;
                      "
                    >
                      Has sido invitado a formar parte de
                      <strong style="color: #ffffff;">${safeFarmName}</strong>
                      con el rol de Consultor.
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding: 26px 30px;">
                    <table
                      role="presentation"
                      width="100%"
                      cellspacing="0"
                      cellpadding="0"
                      border="0"
                      style="
                        width: 100%;
                        border: 1px solid rgba(45, 212, 191, 0.22);
                        border-radius: 14px;
                        background: #111c2f;
                      "
                    >
                      <tr>
                        <td style="padding: 18px;">
                          <p
                            style="
                              margin: 0 0 6px;
                              color: #5eead4;
                              font-family: Arial, sans-serif;
                              font-size: 11px;
                              font-weight: 700;
                              letter-spacing: 1px;
                              text-transform: uppercase;
                            "
                          >
                            Rol asignado
                          </p>

                          <p
                            style="
                              margin: 0;
                              color: #f8fafc;
                              font-family: Arial, sans-serif;
                              font-size: 20px;
                              font-weight: 700;
                            "
                          >
                            Consultor · Solo lectura
                          </p>
                        </td>
                      </tr>
                    </table>

                    <p
                      style="
                        margin: 22px 0 10px;
                        color: #f8fafc;
                        font-family: Arial, sans-serif;
                        font-size: 15px;
                        font-weight: 700;
                      "
                    >
                      Podrás acceder a:
                    </p>

                    <p
                      style="
                        margin: 0;
                        color: #cbd5e1;
                        font-family: Arial, sans-serif;
                        font-size: 14px;
                        line-height: 1.8;
                      "
                    >
                      ✓ Mapa, zonas, puntos y líneas.<br />
                      ✓ Tareas, procesos y clima.<br />
                      ✓ Información operativa asignada a tu trabajo.
                    </p>

                    <p
                      style="
                        margin: 22px 0 10px;
                        color: #f8fafc;
                        font-family: Arial, sans-serif;
                        font-size: 15px;
                        font-weight: 700;
                      "
                    >
                      Acceso restringido:
                    </p>

                    <p
                      style="
                        margin: 0;
                        color: #cbd5e1;
                        font-family: Arial, sans-serif;
                        font-size: 14px;
                        line-height: 1.8;
                      "
                    >
                      × Edición o eliminación del mapa.<br />
                      × Finanzas, reportes y dashboard.<br />
                      × Configuración y administración de accesos.
                    </p>

                    <table
                      role="presentation"
                      cellspacing="0"
                      cellpadding="0"
                      border="0"
                      style="margin: 28px auto 8px;"
                    >
                      <tr>
                        <td
                          align="center"
                          style="
                            border-radius: 999px;
                            background: #2dd4bf;
                          "
                        >
                          <a
                            href="${acceptanceUrl}"
                            target="_blank"
                            rel="noreferrer"
                            style="
                              display: inline-block;
                              padding: 14px 24px;
                              color: #042f2e;
                              font-family: Arial, sans-serif;
                              font-size: 15px;
                              font-weight: 700;
                              text-decoration: none;
                            "
                          >
                            Aceptar invitación
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p
                      style="
                        margin: 22px 0 0;
                        color: #64748b;
                        font-family: Arial, sans-serif;
                        font-size: 12px;
                        line-height: 1.6;
                        text-align: center;
                      "
                    >
                      Si no esperabas esta invitación, puedes ignorar este correo.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  return {
    acceptanceUrl,
    subject,
    text,
    html,
  };
}

export default function farmInvitationsRouter(prisma) {
  const router = express.Router();


  // GET /api/farms/:farmId/team
  router.get("/:farmId/team", requireAuth, async (req, res) => {
    try {
      const { farmId } = req.params;

      const access = await assertFarmAdmin(prisma, farmId, req.user.id);

      if (!access) {
        return res.status(403).json({
          error: "Solo un administrador puede consultar el equipo.",
        });
      }

      const [memberships, invitations] = await Promise.all([
        prisma.farmMember.findMany({
          where: {
            farmId,
            status: "ACTIVE",
          },
          orderBy: {
            createdAt: "asc",
          },
        }),
        prisma.farmInvitation.findMany({
          where: {
            farmId,
            status: {
              in: ["PENDING", "ACCEPTED"],
            },
          },
          orderBy: {
            createdAt: "desc",
          },
        }),
      ]);

      const userIds = [
        ...new Set(
          memberships
            .map((membership) => membership.userId)
            .filter(Boolean)
        ),
      ];

      const users =
        userIds.length > 0
          ? await prisma.user.findMany({
              where: {
                id: {
                  in: userIds,
                },
              },
            })
          : [];

      const usersById = new Map(
        users.map((user) => [String(user.id), user])
      );

      const members = memberships.map((membership) => {
        const user = usersById.get(String(membership.userId)) || {};

        const fullName = [user.firstName, user.lastName]
          .filter(Boolean)
          .join(" ")
          .trim();

        return {
          id: membership.id,
          userId: membership.userId,
          name:
            user.name ||
            fullName ||
            user.fullName ||
            user.email ||
            "Usuario AgroMind",
          email: user.email || "",
          role: membership.role,
          status: membership.status,
          joinedAt: membership.createdAt || null,
        };
      });

      const pendingInvitations = invitations
        .filter((invitation) => invitation.status === "PENDING")
        .map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          invitedById: invitation.invitedById,
          createdAt: invitation.createdAt || null,
          expiresAt: invitation.expiresAt || null,
        }));

      const acceptedInvitations = invitations
        .filter((invitation) => invitation.status === "ACCEPTED")
        .map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          invitedById: invitation.invitedById,
          createdAt: invitation.createdAt || null,
          acceptedAt:
            invitation.acceptedAt ||
            invitation.updatedAt ||
            null,
        }));

      return res.json({
        members,
        pendingInvitations,
        acceptedInvitations,
      });
    } catch (err) {
      console.error("GET_FARM_TEAM_ERROR:", err);
      return res.status(500).json({
        error: "No se pudo cargar el equipo de la finca.",
      });
    }
  });

  // DELETE /api/farms/:farmId/invitations/:invitationId
  router.delete(
    "/:farmId/invitations/:invitationId",
    requireAuth,
    async (req, res) => {
      try {
        const { farmId, invitationId } = req.params;

        const access = await assertFarmAdmin(prisma, farmId, req.user.id);

        if (!access) {
          return res.status(403).json({
            error: "Solo un administrador puede cancelar invitaciones.",
          });
        }

        const invitation = await prisma.farmInvitation.findFirst({
          where: {
            id: invitationId,
            farmId,
            status: "PENDING",
          },
        });

        if (!invitation) {
          return res.status(404).json({
            error: "La invitación pendiente no fue encontrada.",
          });
        }

        await prisma.farmInvitation.delete({
          where: {
            id: invitation.id,
          },
        });

        return res.json({
          ok: true,
          message: "Invitación cancelada correctamente.",
        });
      } catch (err) {
        console.error("DELETE_FARM_INVITATION_ERROR:", err);
        return res.status(500).json({
          error: "No se pudo cancelar la invitación.",
        });
      }
    }
  );

  // DELETE /api/farms/:farmId/members/:memberId
  router.delete(
    "/:farmId/members/:memberId",
    requireAuth,
    async (req, res) => {
      try {
        const { farmId, memberId } = req.params;

        const access = await assertFarmAdmin(prisma, farmId, req.user.id);

        if (!access) {
          return res.status(403).json({
            error: "Solo un administrador puede eliminar accesos.",
          });
        }

        const membership = await prisma.farmMember.findFirst({
          where: {
            id: memberId,
            farmId,
            status: "ACTIVE",
          },
        });

        if (!membership) {
          return res.status(404).json({
            error: "El miembro activo no fue encontrado.",
          });
        }

        if (membership.userId === req.user.id) {
          return res.status(400).json({
            error: "No puedes eliminar tu propio acceso administrativo.",
          });
        }

        if (membership.role === "ADMIN") {
          return res.status(400).json({
            error: "No puedes eliminar a otro administrador desde esta acción.",
          });
        }

        await prisma.farmMember.delete({
          where: {
            id: membership.id,
          },
        });

        return res.json({
          ok: true,
          message: "Acceso eliminado correctamente.",
        });
      } catch (err) {
        console.error("DELETE_FARM_MEMBER_ERROR:", err);
        return res.status(500).json({
          error: "No se pudo eliminar el acceso.",
        });
      }
    }
  );

  // POST /api/farms/:farmId/invitations
  router.post("/:farmId/invitations", requireAuth, async (req, res) => {
    try {
      const { farmId } = req.params;
      const email = normalizeEmail(req.body?.email);

      if (!email) {
        return res.status(400).json({ error: "El correo es obligatorio." });
      }

      if (!isValidEmail(email)) {
        return res.status(400).json({
          error: "El correo electrónico no es válido.",
        });
      }

      const access = await assertFarmAdmin(prisma, farmId, req.user.id);

      if (!access) {
        return res.status(403).json({
          error: "Solo un administrador puede invitar usuarios.",
        });
      }

      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });

      if (user) {
        const existingMember = await prisma.farmMember.findUnique({
          where: {
            userId_farmId: {
              userId: user.id,
              farmId,
            },
          },
          select: {
            id: true,
            status: true,
          },
        });

        if (existingMember?.status === "ACTIVE") {
          return res.status(409).json({
            error: "Esta persona ya tiene acceso activo a la finca.",
          });
        }
      }

      const pending = await prisma.farmInvitation.findFirst({
        where: {
          farmId,
          email,
          status: "PENDING",
        },
        select: { id: true },
      });

      if (pending) {
        return res.status(409).json({
          error: "Ya existe una invitación pendiente para ese correo.",
        });
      }

      const invitationToken = crypto.randomBytes(32).toString("hex");

      const invitation = await prisma.farmInvitation.create({
        data: {
          farmId,
          invitedById: req.user.id,
          email,
          role: "CONSULTANT",
          token: invitationToken,
          status: "PENDING",
        },
      });

      const emailContent = buildInvitationEmail({
        farmName: access.farm?.name,
        invitationToken,
      });

      try {
        await sendEmail({
          to: email,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        });
      } catch (emailError) {
        console.error("FARM_INVITATION_EMAIL_ERROR:", emailError);

        await prisma.farmInvitation.delete({
          where: { id: invitation.id },
        });

        return res.status(502).json({
          error:
            "No se pudo enviar el correo de invitación. Inténtalo nuevamente.",
        });
      }

      return res.status(201).json({
        mode: "invitation_created",
        invitationId: invitation.id,
        message: "Invitación enviada correctamente.",
      });
    } catch (err) {
      console.error("FARM_INVITATION_ERROR:", err);
      return res.status(500).json({
        error: "No se pudo crear la invitación.",
      });
    }
  });

  return router;
}
