// src/routes/componentPhotos.js

import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_PHOTOS_PER_COMPONENT = 5;
const MAX_FILE_SIZE_BYTES = 6 * 1024 * 1024; // 6 MB
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

const uploadsRoot = path.resolve(__dirname, "../../uploads");
const componentUploadsDir = path.join(uploadsRoot, "components");

function ensureUploadDirs() {
  fs.mkdirSync(componentUploadsDir, { recursive: true });
}

function getRequestUserId(req) {
  return (
    req.user?.id ||
    req.userId ||
    req.auth?.userId ||
    req.auth?.id ||
    req.currentUser?.id ||
    null
  );
}

function safeUnlink(filePath) {
  if (!filePath) return;

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.warn("COMPONENT_PHOTO_UNLINK_WARN:", err?.message || err);
  }
}

function getPublicUrl(filename) {
  return `/uploads/components/${filename}`;
}

function getStoredFilePath(filename) {
  return path.join(componentUploadsDir, filename);
}

function findComponentInZone(zone, componentId) {
  const components = Array.isArray(zone?.components) ? zone.components : [];
  return components.find((component) => component?.id === componentId) || null;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureUploadDirs();
    cb(null, componentUploadsDir);
  },
  filename: (req, file, cb) => {
    const extFromName = path.extname(file.originalname || "").toLowerCase();
    const extFromMime =
      file.mimetype === "image/png"
        ? ".png"
        : file.mimetype === "image/webp"
        ? ".webp"
        : ".jpg";

    const ext = [".jpg", ".jpeg", ".png", ".webp"].includes(extFromName)
      ? extFromName
      : extFromMime;

    const safeName = `component-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}${ext}`;

    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error("Solo se permiten imágenes JPG, PNG o WEBP."));
      return;
    }

    cb(null, true);
  },
});

function multerSinglePhoto(req, res, next) {
  upload.single("photo")(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          error: "La imagen supera el límite permitido de 6 MB.",
        });
      }

      return res.status(400).json({
        error: err.message || "No se pudo procesar la imagen.",
      });
    }

    return res.status(400).json({
      error: err?.message || "Archivo inválido.",
    });
  });
}

export default function componentPhotosRouter(prisma) {
  const router = express.Router();

  router.get("/health", (req, res) => {
    res.json({ ok: true, module: "component-photos" });
  });

  // GET /api/farms/component-photos/:zoneId/:componentId
  router.get("/:zoneId/:componentId", async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const { zoneId, componentId } = req.params;

      if (!userId) {
        return res.status(401).json({ error: "No autenticado." });
      }

      if (!zoneId || !componentId) {
        return res.status(400).json({ error: "Faltan zoneId o componentId." });
      }

      const zone = await prisma.mapZone.findFirst({
        where: {
          id: zoneId,
          farm: { userId },
        },
        select: {
          id: true,
          components: true,
        },
      });

      if (!zone) {
        return res.status(404).json({ error: "Zona no encontrada." });
      }

      const component = findComponentInZone(zone, componentId);
      if (!component) {
        return res.status(404).json({ error: "Componente no encontrado en esta zona." });
      }

      const photos = await prisma.componentPhoto.findMany({
        where: { zoneId, componentId },
        orderBy: { createdAt: "desc" },
      });

      res.json({ photos });
    } catch (err) {
      console.error("COMPONENT_PHOTOS_LIST_ERROR:", err);
      res.status(500).json({ error: "No se pudieron cargar las fotos." });
    }
  });

  // POST /api/farms/component-photos/:zoneId/:componentId
  // Body multipart/form-data: photo=<file>
  router.post("/:zoneId/:componentId", multerSinglePhoto, async (req, res) => {
    let uploadedFilePath = req.file?.path || null;

    try {
      const userId = getRequestUserId(req);
      const { zoneId, componentId } = req.params;
      const note = String(req.body?.note || "").trim();

      if (!userId) {
        safeUnlink(uploadedFilePath);
        return res.status(401).json({ error: "No autenticado." });
      }

      if (!zoneId || !componentId) {
        safeUnlink(uploadedFilePath);
        return res.status(400).json({ error: "Faltan zoneId o componentId." });
      }

      if (!req.file) {
        return res.status(400).json({ error: "Selecciona una imagen." });
      }

      const zone = await prisma.mapZone.findFirst({
        where: {
          id: zoneId,
          farm: { userId },
        },
        select: {
          id: true,
          farmId: true,
          components: true,
        },
      });

      if (!zone) {
        safeUnlink(uploadedFilePath);
        return res.status(404).json({ error: "Zona no encontrada." });
      }

      const component = findComponentInZone(zone, componentId);
      if (!component) {
        safeUnlink(uploadedFilePath);
        return res.status(404).json({ error: "Componente no encontrado en esta zona." });
      }

      const currentCount = await prisma.componentPhoto.count({
        where: { zoneId, componentId },
      });

      if (currentCount >= MAX_PHOTOS_PER_COMPONENT) {
        safeUnlink(uploadedFilePath);
        return res.status(409).json({
          error: `Este componente ya tiene el máximo de ${MAX_PHOTOS_PER_COMPONENT} fotos.`,
        });
      }

      const filename = req.file.filename;
      const url = getPublicUrl(filename);

      const photo = await prisma.componentPhoto.create({
        data: {
          farmId: zone.farmId,
          zoneId,
          componentId,
          filename,
          url,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          note: note || null,
        },
      });

      uploadedFilePath = null;

      res.status(201).json({ photo });
    } catch (err) {
      safeUnlink(uploadedFilePath);
      console.error("COMPONENT_PHOTO_UPLOAD_ERROR:", err);
      res.status(500).json({ error: "No se pudo guardar la foto." });
    }
  });

  // DELETE /api/farms/component-photos/:photoId
  router.delete("/:photoId", async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const { photoId } = req.params;

      if (!userId) {
        return res.status(401).json({ error: "No autenticado." });
      }

      if (!photoId) {
        return res.status(400).json({ error: "Falta photoId." });
      }

      const photo = await prisma.componentPhoto.findFirst({
        where: {
          id: photoId,
          farm: { userId },
        },
      });

      if (!photo) {
        return res.status(404).json({ error: "Foto no encontrada." });
      }

      await prisma.componentPhoto.delete({
        where: { id: photo.id },
      });

      safeUnlink(getStoredFilePath(photo.filename));

      res.json({ ok: true, deletedId: photo.id });
    } catch (err) {
      console.error("COMPONENT_PHOTO_DELETE_ERROR:", err);
      res.status(500).json({ error: "No se pudo eliminar la foto." });
    }
  });

  return router;
}
