// src/services/emailService.js
import nodemailer from "nodemailer";

let transporterInstance = null;

function getTransporter() {
  if (transporterInstance) return transporterInstance;

  const user = String(process.env.EMAIL_USER || "").trim();
  const pass = String(process.env.EMAIL_PASS || "").trim();

  if (!user || !pass) {
    throw new Error(
      "Faltan EMAIL_USER o EMAIL_PASS en las variables de entorno."
    );
  }

  transporterInstance = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user,
      pass,
    },
  });

  return transporterInstance;
}

export async function verifyEmailTransport() {
  const transporter = getTransporter();
  await transporter.verify();
  return true;
}

export async function sendEmail({ to, subject, html, text }) {
  const safeTo = String(to || "").trim();

  if (!safeTo) {
    throw new Error("sendEmail requiere destinatario 'to'.");
  }

  const transporter = getTransporter();

  const info = await transporter.sendMail({
    from: `"AgroMind CR" <${process.env.EMAIL_USER}>`,
    to: safeTo,
    subject: subject || "Notificación AgroMind CR",
    text:
      text ||
      "Tienes una nueva notificación en AgroMind CR. Ingresa a https://www.agromindcr.es",
    html:
      html ||
      `
        <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
          <h2 style="margin-bottom: 8px;">AgroMind CR</h2>
          <p>Tienes una nueva notificación.</p>
          <p>
            Ingresa a
            <a href="https://www.agromindcr.es" target="_blank" rel="noreferrer">
              AgroMind CR
            </a>
            para revisar los detalles.
          </p>
        </div>
      `,
  });

  console.log("📩 Email enviado:", info.messageId, "→", safeTo);

  return info;
}