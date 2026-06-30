// src/services/emailService.js
import nodemailer from "nodemailer";

let transporterInstance = null;

function getEmailFrom() {
  return (
    String(process.env.EMAIL_FROM || "").trim() ||
    `"AgroMind CR" <${String(process.env.EMAIL_USER || "").trim()}>`
  );
}

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

async function sendWithResend({ to, subject, html, text }) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();

  if (!apiKey) {
    throw new Error("Falta RESEND_API_KEY en las variables de entorno.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: getEmailFrom(),
      to: [to],
      subject,
      html,
      text,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.message || data?.error || "Resend no pudo enviar el correo."
    );
  }

  console.log("📩 Email enviado con Resend:", data?.id || "sin-id", "→", to);

  return data;
}

async function sendWithGmailSmtp({ to, subject, html, text }) {
  const transporter = getTransporter();

  const info = await transporter.sendMail({
    from: getEmailFrom(),
    to,
    subject,
    text,
    html,
  });

  console.log("📩 Email enviado con Gmail SMTP:", info.messageId, "→", to);

  return info;
}

export async function verifyEmailTransport() {
  const resendApiKey = String(process.env.RESEND_API_KEY || "").trim();

  if (resendApiKey) {
    console.log("✅ Email configurado con Resend.");
    return true;
  }

  const transporter = getTransporter();
  await transporter.verify();
  return true;
}

export async function sendEmail({ to, subject, html, text }) {
  const safeTo = String(to || "").trim();

  if (!safeTo) {
    throw new Error("sendEmail requiere destinatario 'to'.");
  }

  const finalSubject = subject || "Notificación AgroMind CR";
  const finalText =
    text ||
    "Tienes una nueva notificación en AgroMind CR. Ingresa a https://www.agromindcr.es";

  const finalHtml =
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
    `;

  if (String(process.env.RESEND_API_KEY || "").trim()) {
    return sendWithResend({
      to: safeTo,
      subject: finalSubject,
      html: finalHtml,
      text: finalText,
    });
  }

  return sendWithGmailSmtp({
    to: safeTo,
    subject: finalSubject,
    html: finalHtml,
    text: finalText,
  });
}