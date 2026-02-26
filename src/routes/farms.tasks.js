// src/routes/farms.tasks.js
export function registerTaskRoutes(ctx) {
  const {
    prisma,
    router,
    requireAuth,
    looksLikeId,
    isNonEmptyString,
    cleanName,
    parseISODateOnlyToUTC,
    toYYYYMMDD,
    normalizeText,
    assertFarmOwner,
  } = ctx;

  // GET /api/farms/:id/tasks
  router.get("/farms/:id/tasks", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const userId = req.user.id;

      if (!looksLikeId(farmId))
        return res.status(400).json({ error: "farmId inválido." });

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const tasks = await prisma.task.findMany({
        where: { farmId },
        orderBy: [{ due: "asc" }, { createdAt: "desc" }],
        select: {
          id: true,
          farmId: true,
          title: true,
          zone: true,
          type: true,
          priority: true,
          start: true,
          due: true,
          status: true,
          owner: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.json({ tasks });
    } catch (err) {
      console.error("GET_TASKS_ERROR:", err);
      return res.status(500).json({ error: "Error interno listando tareas." });
    }
  });

  // GET /api/farms/:id/tasks/suggestions
  router.get("/farms/:id/tasks/suggestions", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const userId = req.user.id;

      if (!looksLikeId(farmId))
        return res.status(400).json({ error: "farmId inválido." });

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const tasks = await prisma.task.findMany({
        where: { farmId },
        select: {
          id: true,
          title: true,
          zone: true,
          type: true,
          priority: true,
          status: true,
          start: true,
          due: true,
          owner: true,
          createdAt: true,
        },
      });

      const zones = await prisma.mapZone.findMany({
        where: { farmId },
        select: { name: true, components: true },
      });

      const MS_DAY = 1000 * 60 * 60 * 24;
      const now = new Date();
      const todayUtcNoon = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0)
      );

      const suggestions = [];
      const seen = new Set();

      function pushSuggestion(s) {
        const key = `${s.code}:${s.zone || ""}:${s.title || ""}:${s.due || ""}:${s.message || ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        suggestions.push(s);
      }

      function normText(s) {
        return String(s || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim();
      }

      function hasSimilarActiveTask(zoneName, keywords = []) {
        const zn = normText(zoneName);
        const keys = keywords.map(normText).filter(Boolean);

        return tasks.some((t) => {
          if (!t || t.status === "Completada") return false;
          const tZone = normText(t.zone || "");
          if (zn && tZone !== zn) return false;

          const hay = normText(`${t.title || ""} ${t.type || ""}`);
          if (keys.length === 0) return false;
          return keys.some((k) => k && hay.includes(k));
        });
      }

      function listFromUnknown(x) {
        if (!x) return [];
        if (Array.isArray(x)) return x;
        if (typeof x === "string") return [x];
        if (typeof x === "object") {
          const out = [];
          for (const [k, v] of Object.entries(x)) {
            if (!k) continue;
            if (v === true) out.push(k);
            else if (typeof v === "number" && v > 0) out.push(`${k} (${v})`);
            else if (typeof v === "string" && v.trim()) out.push(v.trim());
            else if (v && typeof v === "object" && (v.name || v.tipo)) {
              out.push(String(v.name || v.tipo || k));
            }
          }
          return out;
        }
        return [];
      }

      function firstNonEmptyList(...candidates) {
        for (const cand of candidates) {
          const arr = listFromUnknown(cand);
          if (Array.isArray(arr) && arr.length > 0) return arr;
        }
        return [];
      }

      function extractComponents(components) {
        const c = components && typeof components === "object" ? components : {};

        const crops = firstNonEmptyList(
          c.cultivos,
          c.cultivo,
          c.crops,
          c.crop,
          c.plantas,
          c.planta
        );

        const animals = firstNonEmptyList(
          c.animales,
          c.animal,
          c.animals,
          c.animalList,
          c.ganado
        );

        let other = [];
        if (crops.length === 0 && animals.length === 0) {
          other = listFromUnknown(c);
        }

        const cleanArr = (arr) =>
          (Array.isArray(arr) ? arr : [])
            .map((x) => String(x || "").trim())
            .filter(Boolean)
            .slice(0, 12);

        return {
          crops: cleanArr(crops),
          animals: cleanArr(animals),
          other: cleanArr(other),
        };
      }

      const zoneNames = zones
        .map((z) => (isNonEmptyString(z?.name) ? z.name.trim() : ""))
        .filter(Boolean);

      const todayStr = toYYYYMMDD(todayUtcNoon);

      for (const z of zones) {
        const zoneName = isNonEmptyString(z?.name) ? z.name.trim() : "";
        if (!zoneName) continue;

        const { crops, animals, other } = extractComponents(z.components);

        for (const crop of crops) {
          if (!hasSimilarActiveTask(zoneName, ["abonar", "fertiliz", crop])) {
            pushSuggestion({
              id: `crop_${zoneName}_${crop}`.slice(0, 180),
              code: "ZONE_COMPONENT_CROP",
              level: "info",
              title: "Acción recomendada para cultivo",
              message: `Zona "${zoneName}": revisar y planificar labores para el cultivo (${crop}).`,
              zone: zoneName,
              actionPayload: {
                title: `Revisión de cultivo (${crop})`,
                zone: zoneName,
                type: "Mantenimiento",
                priority: "Media",
                start: todayStr,
                due: todayStr,
                status: "Pendiente",
                owner: "",
              },
            });
          }
        }

        for (const animal of animals) {
          if (!hasSimilarActiveTask(zoneName, ["aliment", "agua", animal])) {
            pushSuggestion({
              id: `animal_feed_${zoneName}_${animal}`.slice(0, 180),
              code: "ZONE_COMPONENT_ANIMAL_FEED",
              level: "info",
              title: "Rutina de animales",
              message: `Zona "${zoneName}": revisar agua y alimentación para (${animal}).`,
              zone: zoneName,
              actionPayload: {
                title: `Revisar agua/alimento (${animal})`,
                zone: zoneName,
                type: "Alimentación",
                priority: "Media",
                start: todayStr,
                due: todayStr,
                status: "Pendiente",
                owner: "",
              },
            });
          }
        }

        if (crops.length === 0 && animals.length === 0 && other.length > 0) {
          if (!hasSimilarActiveTask(zoneName, ["inspeccion", "revision"])) {
            pushSuggestion({
              id: `zone_other_${zoneName}`.slice(0, 180),
              code: "ZONE_COMPONENT_OTHER",
              level: "info",
              title: "Inspección por componentes",
              message: `Zona "${zoneName}": hay componentes registrados. Recomendación: inspección preventiva y actualización de tareas.`,
              zone: zoneName,
              actionPayload: {
                title: `Inspección preventiva (${zoneName})`,
                zone: zoneName,
                type: "Mantenimiento",
                priority: "Media",
                start: todayStr,
                due: todayStr,
                status: "Pendiente",
                owner: "",
              },
            });
          }
        }
      }

      for (const t of tasks) {
        if (!t?.due || !t?.title) continue;
        if (t.status === "Completada") continue;

        const dueDate = new Date(t.due);
        const diffDays = Math.ceil((dueDate.getTime() - todayUtcNoon.getTime()) / MS_DAY);

        if (diffDays >= 0 && diffDays <= 2) {
          pushSuggestion({
            id: `due_soon_${t.id}`,
            code: "DUE_SOON",
            level: diffDays === 0 ? "alert" : "warning",
            title: diffDays === 0 ? "Vence hoy" : "Vence pronto",
            message:
              diffDays === 0
                ? `La tarea "${t.title}" vence hoy.`
                : `La tarea "${t.title}" vence en ${diffDays} día(s).`,
            zone: t.zone || null,
            actionPayload: {
              title: `Seguimiento: ${t.title}`,
              zone: t.zone || "",
              type: t.type || "Mantenimiento",
              priority: "Alta",
              start: toYYYYMMDD(t.start || dueDate),
              due: toYYYYMMDD(dueDate),
              status: "Pendiente",
              owner: t.owner || "",
            },
          });
        }
      }

      for (const zn of zoneNames) {
        const hasActive = tasks.some(
          (t) => (t.zone || "").trim() === zn && t.status !== "Completada"
        );
        if (!hasActive) {
          pushSuggestion({
            id: `zone_empty_${zn}`,
            code: "ZONE_NO_ACTIVE_TASKS",
            level: "info",
            title: "Zona sin tareas activas",
            message: `La zona "${zn}" no tiene tareas activas.`,
            zone: zn,
            actionPayload: {
              title: `Inspección preventiva - ${zn}`,
              zone: zn,
              type: "Mantenimiento",
              priority: "Media",
              start: todayStr,
              due: todayStr,
              status: "Pendiente",
              owner: "",
            },
          });
        }
      }

      const pendingCount = tasks.filter((t) => t.status === "Pendiente").length;
      if (pendingCount >= 5) {
        pushSuggestion({
          id: `too_many_pending_${pendingCount}`,
          code: "TOO_MANY_PENDING",
          level: "warning",
          title: "Carga alta de pendientes",
          message: `Tenés ${pendingCount} tareas en estado "Pendiente". Considerá priorizar o dividir trabajo.`,
          zone: null,
          actionPayload: null,
        });
      }

      for (const t of tasks) {
        if (!t?.due || !t?.title) continue;
        if (t.status === "Completada") continue;

        const dueDate = new Date(t.due);
        const diffDays = Math.floor((todayUtcNoon.getTime() - dueDate.getTime()) / MS_DAY);
        if (diffDays >= 1) {
          pushSuggestion({
            id: `overdue_${t.id}`,
            code: "OVERDUE",
            level: "alert",
            title: "Tarea atrasada",
            message: `La tarea "${t.title}" está atrasada por ${diffDays} día(s).`,
            zone: t.zone || null,
            actionPayload: {
              title: `Reprogramar: ${t.title}`,
              zone: t.zone || "",
              type: t.type || "Mantenimiento",
              priority: "Alta",
              start: toYYYYMMDD(t.start || dueDate),
              due: toYYYYMMDD(todayUtcNoon),
              status: "Pendiente",
              owner: t.owner || "",
            },
          });
        }
      }

      return res.json({ suggestions });
    } catch (err) {
      console.error("TASK_SUGGESTIONS_ERROR:", err);
      return res.status(500).json({ error: "Error generando sugerencias." });
    }
  });

  // POST /api/farms/:id/tasks
  router.post("/farms/:id/tasks", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const userId = req.user.id;

      if (!looksLikeId(farmId))
        return res.status(400).json({ error: "farmId inválido." });

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const { title, zone, type, priority, start, due, status, owner } = req.body || {};

      const finalTitle = cleanName(title, "");
      if (!finalTitle) return res.status(400).json({ error: "title es requerido." });

      const finalType = cleanName(type, "Mantenimiento");
      const finalPriority = cleanName(priority, "Media");
      const finalStatus = cleanName(status, "Pendiente");
      const finalZone = isNonEmptyString(zone) ? zone.trim().slice(0, 120) : null;
      const finalOwner = isNonEmptyString(owner) ? owner.trim().slice(0, 80) : null;

      const startDate = parseISODateOnlyToUTC(start);
      if (!startDate) return res.status(400).json({ error: "start debe ser YYYY-MM-DD." });

      const dueDate = parseISODateOnlyToUTC(due);
      if (!dueDate) return res.status(400).json({ error: "due debe ser YYYY-MM-DD." });

      if (startDate.getTime() > dueDate.getTime()) {
        return res.status(400).json({ error: "start no puede ser posterior a due." });
      }

      const task = await prisma.task.create({
        data: {
          farmId,
          title: finalTitle,
          zone: finalZone,
          type: finalType,
          priority: finalPriority,
          start: startDate,
          due: dueDate,
          status: finalStatus,
          owner: finalOwner,
        },
        select: {
          id: true,
          farmId: true,
          title: true,
          zone: true,
          type: true,
          priority: true,
          start: true,
          due: true,
          status: true,
          owner: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.status(201).json({ task });
    } catch (err) {
      console.error("CREATE_TASK_ERROR:", err);
      return res.status(500).json({ error: "Error interno creando tarea." });
    }
  });

  // PUT /api/farms/:id/tasks/:taskId
  router.put("/farms/:id/tasks/:taskId", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const taskId = req.params.taskId;
      const userId = req.user.id;

      if (!looksLikeId(farmId) || !looksLikeId(taskId)) {
        return res.status(400).json({ error: "IDs inválidos." });
      }

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const existing = await prisma.task.findFirst({
        where: { id: taskId, farmId },
        select: { id: true, start: true, due: true },
      });
      if (!existing) return res.status(404).json({ error: "Tarea no encontrada." });

      const { title, zone, type, priority, start, due, status, owner } = req.body || {};
      const data = {};

      if (title !== undefined) {
        const finalTitle = cleanName(title, "");
        if (!finalTitle) return res.status(400).json({ error: "title inválido." });
        data.title = finalTitle;
      }

      if (zone !== undefined) {
        data.zone = isNonEmptyString(zone) ? zone.trim().slice(0, 120) : null;
      }

      if (type !== undefined) data.type = cleanName(type, "Mantenimiento");
      if (priority !== undefined) data.priority = cleanName(priority, "Media");
      if (status !== undefined) data.status = cleanName(status, "Pendiente");

      if (owner !== undefined) {
        data.owner = isNonEmptyString(owner) ? owner.trim().slice(0, 80) : null;
      }

      let nextStart = existing.start;
      let nextDue = existing.due;

      if (start !== undefined) {
        const startDate = parseISODateOnlyToUTC(start);
        if (!startDate) return res.status(400).json({ error: "start debe ser YYYY-MM-DD." });
        data.start = startDate;
        nextStart = startDate;
      }

      if (due !== undefined) {
        const dueDate = parseISODateOnlyToUTC(due);
        if (!dueDate) return res.status(400).json({ error: "due debe ser YYYY-MM-DD." });
        data.due = dueDate;
        nextDue = dueDate;
      }

      if (nextStart.getTime() > nextDue.getTime()) {
        return res.status(400).json({ error: "start no puede ser posterior a due." });
      }

      const task = await prisma.task.update({
        where: { id: taskId },
        data,
        select: {
          id: true,
          farmId: true,
          title: true,
          zone: true,
          type: true,
          priority: true,
          start: true,
          due: true,
          status: true,
          owner: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.json({ ok: true, task });
    } catch (err) {
      console.error("UPDATE_TASK_ERROR:", err);
      return res.status(500).json({ error: "Error interno actualizando tarea." });
    }
  });

  // DELETE /api/farms/:id/tasks/:taskId
  router.delete("/farms/:id/tasks/:taskId", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const taskId = req.params.taskId;
      const userId = req.user.id;

      if (!looksLikeId(farmId) || !looksLikeId(taskId)) {
        return res.status(400).json({ error: "IDs inválidos." });
      }

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const existing = await prisma.task.findFirst({
        where: { id: taskId, farmId },
        select: { id: true },
      });
      if (!existing) return res.status(404).json({ error: "Tarea no encontrada." });

      await prisma.task.delete({ where: { id: taskId } });
      return res.json({ ok: true });
    } catch (err) {
      console.error("DELETE_TASK_ERROR:", err);
      return res.status(500).json({ error: "Error interno eliminando tarea." });
    }
  });
}