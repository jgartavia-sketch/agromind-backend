// src/routes/farmInvitations.js

import express from "express";
import crypto from "crypto";
import { requireAuth } from "./farms.base.js";
import { assertFarmAdmin } from "../services/farmAccess.js";

export default function farmInvitationsRouter(prisma) {
  const router = express.Router();

  // POST /api/farms/:farmId/invitations
  router.post("/:farmId/invitations", requireAuth, async (req, res) => {
    try {
      const { farmId } = req.params;
      const email = String(req.body?.email || "").trim().toLowerCase();

      if (!email) {
        return res.status(400).json({ error: "El correo es obligatorio." });
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
        });

        if (existingMember) {
          await prisma.farmMember.update({
            where: { id: existingMember.id },
            data: {
              role: "CONSULTANT",
              status: "ACTIVE",
            },
          });

          return res.json({
            mode: "member_reactivated",
            message: "El consultor ya tenía acceso y fue reactivado.",
          });
        }

        await prisma.farmMember.create({
          data: {
            userId: user.id,
            farmId,
            role: "CONSULTANT",
            status: "ACTIVE",
          },
        });

        return res.json({
          mode: "member_created",
          message: "Consultor agregado correctamente.",
        });
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

      const invitation = await prisma.farmInvitation.create({
        data: {
          farmId,
          invitedById: req.user.id,
          email,
          role: "CONSULTANT",
          token: crypto.randomBytes(32).toString("hex"),
          status: "PENDING",
        },
      });

      return res.status(201).json({
        mode: "invitation_created",
        invitationId: invitation.id,
        message: "Invitación creada correctamente.",
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
