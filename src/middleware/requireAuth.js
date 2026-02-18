// src/middleware/requireAuth.js
import jwt from "jsonwebtoken";

export default function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) return res.status(401).json({ error: "Sin token." });

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ error: "Falta JWT_SECRET en el servidor." });
    }

    const payload = jwt.verify(token, secret);
    const userId = payload?.sub;

    if (!userId) return res.status(401).json({ error: "Token inválido." });

    // 🔒 Adjuntamos el userId a la request (no viene del body)
    req.userId = String(userId);
    req.userEmail = payload?.email || null;
    req.userName = payload?.name || null;

    return next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado." });
  }
}
