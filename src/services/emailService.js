import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export async function sendEmail({ to, subject, html }) {
  try {
    const info = await transporter.sendMail({
      from: `"AgroMind CR" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });

    console.log("Email enviado:", info.messageId);
  } catch (error) {
    console.error("Error enviando email:", error);
  }
}