// src/services/taskReminderService.js
import { sendEmail } from "./emailService.js";

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDateCR(date) {
  try {
    return new Intl.DateTimeFormat("es-CR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(date));
  } catch {
    return String(date);
  }
}

function buildTaskDueTomorrowEmail({ userName, farmName, tasks }) {
  const safeUserName = userName || "Usuario";
  const safeFarmName = farmName || "tu finca";

  const tasksHtml = tasks
    .map(
      (task) => `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${task.title}</td>
          <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${task.zone || "—"}</td>
          <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${task.type || "—"}</td>
          <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${task.priority || "—"}</td>
          <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${formatDateCR(task.due)}</td>
        </tr>
      `
    )
    .join("");

  const textLines = tasks.map(
    (task) =>
      `- ${task.title} | Zona: ${task.zone || "—"} | Tipo: ${
        task.type || "—"
      } | Prioridad: ${task.priority || "—"} | Vence: ${formatDateCR(task.due)}`
  );

  return {
    subject: `AgroMind CR • ${tasks.length} tarea(s) vencen mañana`,
    text: [
      `Hola ${safeUserName},`,
      ``,
      `Estas tareas de ${safeFarmName} vencen mañana:`,
      ...textLines,
      ``,
      `Revisa tu operación en https://www.agromindcr.es`,
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.6;">
        <h2 style="margin:0 0 8px 0;">AgroMind CR</h2>
        <p style="margin:0 0 12px 0;">Hola <strong>${safeUserName}</strong>,</p>
        <p style="margin:0 0 12px 0;">
          Estas tareas de <strong>${safeFarmName}</strong> vencen mañana.
        </p>

        <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#ffffff;">
          <thead>
            <tr style="background:#f3f4f6;text-align:left;">
              <th style="padding:10px;border-bottom:1px solid #d1d5db;">Tarea</th>
              <th style="padding:10px;border-bottom:1px solid #d1d5db;">Zona</th>
              <th style="padding:10px;border-bottom:1px solid #d1d5db;">Tipo</th>
              <th style="padding:10px;border-bottom:1px solid #d1d5db;">Prioridad</th>
              <th style="padding:10px;border-bottom:1px solid #d1d5db;">Vence</th>
            </tr>
          </thead>
          <tbody>
            ${tasksHtml}
          </tbody>
        </table>

        <p style="margin:16px 0 0 0;">
          Abre tu panel:
          <a href="https://www.agromindcr.es" target="_blank" rel="noreferrer">
            www.agromindcr.es
          </a>
        </p>
      </div>
    `,
  };
}

export async function sendDueTomorrowTaskReminders(prisma) {
  const now = new Date();
  const tomorrow = addDays(now, 1);

  const tomorrowStart = startOfDay(tomorrow);
  const tomorrowEnd = endOfDay(tomorrow);

  const tasks = await prisma.task.findMany({
    where: {
      due: {
        gte: tomorrowStart,
        lte: tomorrowEnd,
      },
      status: {
        not: "Completada",
      },
    },
    include: {
      farm: {
        include: {
          user: true,
        },
      },
    },
    orderBy: [{ due: "asc" }, { createdAt: "asc" }],
  });

  if (!tasks.length) {
    console.log("📭 No hay tareas para recordar mañana.");
    return {
      ok: true,
      scanned: 0,
      usersNotified: 0,
    };
  }

  const groupedByUserAndFarm = new Map();

  for (const task of tasks) {
    const userEmail = task?.farm?.user?.email;
    const userId = task?.farm?.user?.id;
    const farmId = task?.farm?.id;

    if (!userEmail || !userId || !farmId) continue;

    const key = `${userId}::${farmId}`;

    if (!groupedByUserAndFarm.has(key)) {
      groupedByUserAndFarm.set(key, {
        userEmail,
        userName: task.farm.user.name || "",
        farmName: task.farm.name || "Mi finca",
        tasks: [],
      });
    }

    groupedByUserAndFarm.get(key).tasks.push(task);
  }

  let usersNotified = 0;

  for (const [, group] of groupedByUserAndFarm) {
    const emailPayload = buildTaskDueTomorrowEmail(group);

    await sendEmail({
      to: group.userEmail,
      subject: emailPayload.subject,
      text: emailPayload.text,
      html: emailPayload.html,
    });

    usersNotified += 1;
  }

  console.log(
    `✅ Recordatorios enviados. Usuarios notificados: ${usersNotified}`
  );

  return {
    ok: true,
    scanned: tasks.length,
    usersNotified,
  };
}