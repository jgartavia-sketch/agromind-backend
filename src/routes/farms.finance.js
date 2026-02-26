// src/routes/farms.finance.js
export function registerFinanceRoutes(ctx) {
  const {
    prisma,
    router,
    requireAuth,
    looksLikeId,
    isNonEmptyString,
    parseDateAnyToUTC,
    parseAmount,
    normalizeType,
    keywordCategory,
    normalizeText,
    toYYYYMMDD,
    monthKeyUTC,
    startOfMonthUTC,
    startOfNextMonthUTC,
    prevMonthKey,
    assertFarmOwner,
    assertAssetOwner,
  } = ctx;

  // =========================
  // MOVEMENTS
  // =========================

  router.get("/farms/:id/finance/movements", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const userId = req.user.id;

      if (!looksLikeId(farmId)) return res.status(400).json({ error: "farmId inválido." });

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const movements = await prisma.financeMovement.findMany({
        where: { farmId },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          farmId: true,
          date: true,
          concept: true,
          category: true,
          type: true,
          amount: true,
          note: true,
          invoiceNumber: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.json({ movements });
    } catch (err) {
      console.error("GET_FINANCE_MOVEMENTS_ERROR:", err);
      return res.status(500).json({ error: "Error interno listando movimientos." });
    }
  });

  router.post("/farms/:id/finance/movements", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const userId = req.user.id;

      if (!looksLikeId(farmId)) return res.status(400).json({ error: "farmId inválido." });

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const { date, concept, category, type, amount, note, invoiceNumber } = req.body || {};

      const finalConcept = isNonEmptyString(concept) ? concept.trim().slice(0, 160) : "";
      if (!finalConcept) return res.status(400).json({ error: "concept es requerido." });

      const rawCategory = isNonEmptyString(category) ? category.trim().slice(0, 80) : "General";
      const finalCategory = keywordCategory(finalConcept, rawCategory);

      const finalType = normalizeType(type);
      if (!finalType) return res.status(400).json({ error: 'type debe ser "Ingreso" o "Gasto".' });

      const finalAmount = parseAmount(amount);
      if (finalAmount === null)
        return res.status(400).json({ error: "amount inválido (debe ser número >= 0)." });

      const finalDate = parseDateAnyToUTC(date) || new Date();
      if (!finalDate) return res.status(400).json({ error: "date inválida." });

      const finalNote = isNonEmptyString(note) ? note.trim().slice(0, 240) : null;

      const finalInvoiceNumber = isNonEmptyString(invoiceNumber)
        ? invoiceNumber.trim().slice(0, 60)
        : null;

      const movement = await prisma.financeMovement.create({
        data: {
          farmId,
          date: finalDate,
          concept: finalConcept,
          category: finalCategory,
          type: finalType,
          amount: finalAmount,
          note: finalNote,
          invoiceNumber: finalInvoiceNumber,
        },
        select: {
          id: true,
          farmId: true,
          date: true,
          concept: true,
          category: true,
          type: true,
          amount: true,
          note: true,
          invoiceNumber: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.status(201).json({ movement });
    } catch (err) {
      console.error("CREATE_FINANCE_MOVEMENT_ERROR:", err);
      return res.status(500).json({ error: "Error interno creando movimiento." });
    }
  });

  router.put("/farms/:id/finance/movements/:movementId", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const movementId = req.params.movementId;
      const userId = req.user.id;

      if (!looksLikeId(farmId) || !looksLikeId(movementId)) {
        return res.status(400).json({ error: "IDs inválidos." });
      }

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const existing = await prisma.financeMovement.findFirst({
        where: { id: movementId, farmId },
        select: { id: true, concept: true, category: true },
      });
      if (!existing) return res.status(404).json({ error: "Movimiento no encontrado." });

      const { date, concept, category, type, amount, note, invoiceNumber } = req.body || {};
      const data = {};

      let nextConcept = existing.concept;
      let nextCategory = existing.category;

      if (concept !== undefined) {
        const finalConcept = isNonEmptyString(concept) ? concept.trim().slice(0, 160) : "";
        if (!finalConcept) return res.status(400).json({ error: "concept inválido." });
        data.concept = finalConcept;
        nextConcept = finalConcept;
      }

      if (category !== undefined) {
        const rawCategory = isNonEmptyString(category) ? category.trim().slice(0, 80) : "General";
        data.category = rawCategory;
        nextCategory = rawCategory;
      }

      if (data.concept !== undefined || data.category !== undefined) {
        data.category = keywordCategory(nextConcept, nextCategory);
      }

      if (type !== undefined) {
        const finalType = normalizeType(type);
        if (!finalType) return res.status(400).json({ error: 'type debe ser "Ingreso" o "Gasto".' });
        data.type = finalType;
      }

      if (amount !== undefined) {
        const finalAmount = parseAmount(amount);
        if (finalAmount === null)
          return res.status(400).json({ error: "amount inválido (debe ser número >= 0)." });
        data.amount = finalAmount;
      }

      if (date !== undefined) {
        const finalDate = parseDateAnyToUTC(date);
        if (!finalDate) return res.status(400).json({ error: "date inválida." });
        data.date = finalDate;
      }

      if (note !== undefined) {
        data.note = isNonEmptyString(note) ? note.trim().slice(0, 240) : null;
      }

      if (invoiceNumber !== undefined) {
        data.invoiceNumber = isNonEmptyString(invoiceNumber)
          ? invoiceNumber.trim().slice(0, 60)
          : null;
      }

      const movement = await prisma.financeMovement.update({
        where: { id: movementId },
        data,
        select: {
          id: true,
          farmId: true,
          date: true,
          concept: true,
          category: true,
          type: true,
          amount: true,
          note: true,
          invoiceNumber: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.json({ ok: true, movement });
    } catch (err) {
      console.error("UPDATE_FINANCE_MOVEMENT_ERROR:", err);
      return res.status(500).json({ error: "Error interno actualizando movimiento." });
    }
  });

  router.delete("/farms/:id/finance/movements/:movementId", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const movementId = req.params.movementId;
      const userId = req.user.id;

      if (!looksLikeId(farmId) || !looksLikeId(movementId)) {
        return res.status(400).json({ error: "IDs inválidos." });
      }

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const existing = await prisma.financeMovement.findFirst({
        where: { id: movementId, farmId },
        select: { id: true },
      });
      if (!existing) return res.status(404).json({ error: "Movimiento no encontrado." });

      await prisma.financeMovement.delete({ where: { id: movementId } });
      return res.json({ ok: true });
    } catch (err) {
      console.error("DELETE_FINANCE_MOVEMENT_ERROR:", err);
      return res.status(500).json({ error: "Error interno eliminando movimiento." });
    }
  });

  // =========================
  // ASSETS — CRUD básico
  // =========================

  router.get("/farms/:id/finance/assets", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const userId = req.user.id;

      if (!looksLikeId(farmId)) return res.status(400).json({ error: "farmId inválido." });

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const assets = await prisma.asset.findMany({
        where: { farmId },
        orderBy: [{ purchaseDate: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          farmId: true,
          name: true,
          category: true,
          purchaseValue: true,
          purchaseDate: true,
          usefulLifeYears: true,
          residualValue: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.json({ assets });
    } catch (err) {
      console.error("GET_ASSETS_ERROR:", err);
      return res.status(500).json({ error: "Error interno listando activos." });
    }
  });

  router.post("/farms/:id/finance/assets", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const userId = req.user.id;

      if (!looksLikeId(farmId)) return res.status(400).json({ error: "farmId inválido." });

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const { name, category, purchaseValue, purchaseDate, usefulLifeYears, residualValue } =
        req.body || {};

      const finalName = isNonEmptyString(name) ? name.trim().slice(0, 120) : "";
      if (!finalName) return res.status(400).json({ error: "name es requerido." });

      const finalCategory = isNonEmptyString(category) ? category.trim().slice(0, 60) : "Equipos";

      const pv = parseAmount(purchaseValue);
      if (pv === null) return res.status(400).json({ error: "purchaseValue inválido." });

      const rv = residualValue === undefined || residualValue === null ? 0 : parseAmount(residualValue);
      if (rv === null) return res.status(400).json({ error: "residualValue inválido." });

      const pd = parseDateAnyToUTC(purchaseDate) || new Date();
      if (!pd) return res.status(400).json({ error: "purchaseDate inválida." });

      const uly = usefulLifeYears === undefined || usefulLifeYears === null ? 1 : Number(usefulLifeYears);
      if (!Number.isFinite(uly) || uly <= 0 || uly > 50) {
        return res.status(400).json({ error: "usefulLifeYears inválido (1–50)." });
      }

      const asset = await prisma.asset.create({
        data: {
          farmId,
          name: finalName,
          category: finalCategory,
          purchaseValue: pv,
          purchaseDate: pd,
          usefulLifeYears: uly,
          residualValue: rv,
        },
        select: {
          id: true,
          farmId: true,
          name: true,
          category: true,
          purchaseValue: true,
          purchaseDate: true,
          usefulLifeYears: true,
          residualValue: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.status(201).json({ asset });
    } catch (err) {
      console.error("CREATE_ASSET_ERROR:", err);
      return res.status(500).json({ error: "Error interno creando activo." });
    }
  });

  router.put("/farms/:id/finance/assets/:assetId", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const assetId = req.params.assetId;
      const userId = req.user.id;

      if (!looksLikeId(farmId) || !looksLikeId(assetId)) {
        return res.status(400).json({ error: "IDs inválidos." });
      }

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const existing = await assertAssetOwner(assetId, farmId);
      if (!existing) return res.status(404).json({ error: "Activo no encontrado." });

      const { name, category, purchaseValue, purchaseDate, usefulLifeYears, residualValue } =
        req.body || {};

      const data = {};

      if (name !== undefined) {
        const finalName = isNonEmptyString(name) ? name.trim().slice(0, 120) : "";
        if (!finalName) return res.status(400).json({ error: "name inválido." });
        data.name = finalName;
      }

      if (category !== undefined) {
        data.category = isNonEmptyString(category) ? category.trim().slice(0, 60) : "Equipos";
      }

      if (purchaseValue !== undefined) {
        const pv = parseAmount(purchaseValue);
        if (pv === null) return res.status(400).json({ error: "purchaseValue inválido." });
        data.purchaseValue = pv;
      }

      if (purchaseDate !== undefined) {
        const pd = parseDateAnyToUTC(purchaseDate);
        if (!pd) return res.status(400).json({ error: "purchaseDate inválida." });
        data.purchaseDate = pd;
      }

      if (usefulLifeYears !== undefined) {
        const uly = Number(usefulLifeYears);
        if (!Number.isFinite(uly) || uly <= 0 || uly > 50) {
          return res.status(400).json({ error: "usefulLifeYears inválido (1–50)." });
        }
        data.usefulLifeYears = uly;
      }

      if (residualValue !== undefined) {
        const rv = residualValue === null ? 0 : parseAmount(residualValue);
        if (rv === null) return res.status(400).json({ error: "residualValue inválido." });
        data.residualValue = rv;
      }

      const asset = await prisma.asset.update({
        where: { id: assetId },
        data,
        select: {
          id: true,
          farmId: true,
          name: true,
          category: true,
          purchaseValue: true,
          purchaseDate: true,
          usefulLifeYears: true,
          residualValue: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.json({ ok: true, asset });
    } catch (err) {
      console.error("UPDATE_ASSET_ERROR:", err);
      return res.status(500).json({ error: "Error interno actualizando activo." });
    }
  });

  router.delete("/farms/:id/finance/assets/:assetId", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const assetId = req.params.assetId;
      const userId = req.user.id;

      if (!looksLikeId(farmId) || !looksLikeId(assetId)) {
        return res.status(400).json({ error: "IDs inválidos." });
      }

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const existing = await assertAssetOwner(assetId, farmId);
      if (!existing) return res.status(404).json({ error: "Activo no encontrado." });

      await prisma.asset.delete({ where: { id: assetId } });
      return res.json({ ok: true });
    } catch (err) {
      console.error("DELETE_ASSET_ERROR:", err);
      return res.status(500).json({ error: "Error interno eliminando activo." });
    }
  });

  // =========================
  // INSIGHTS FINANCIEROS
  // GET /api/farms/:id/finance/insights
  // =========================

  router.get("/farms/:id/finance/insights", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const userId = req.user.id;

      if (!looksLikeId(farmId)) return res.status(400).json({ error: "farmId inválido." });

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const [movements, zones, tasks] = await Promise.all([
        prisma.financeMovement.findMany({
          where: { farmId },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          select: {
            id: true,
            date: true,
            concept: true,
            category: true,
            type: true,
            amount: true,
            invoiceNumber: true,
          },
        }),
        prisma.mapZone.findMany({
          where: { farmId },
          select: { name: true, components: true },
        }),
        prisma.task.findMany({
          where: { farmId },
          select: { id: true, title: true, zone: true, status: true },
        }),
      ]);

      const now = new Date();
      const thisMonth = monthKeyUTC(now);
      const prevMonth = prevMonthKey(thisMonth);

      const startThis = startOfMonthUTC(now);
      const startNext = startOfNextMonthUTC(now);

      const monthMovs = movements.filter((m) => {
        const d = new Date(m.date);
        return d >= startThis && d < startNext;
      });

      const prevMovs = movements.filter((m) => monthKeyUTC(m.date) === prevMonth);

      const sumByType = (list) => {
        let ingresos = 0;
        let gastos = 0;
        for (const m of list) {
          const amt = Number(m.amount || 0);
          if (m.type === "Ingreso") ingresos += amt;
          else if (m.type === "Gasto") gastos += amt;
        }
        const balance = ingresos - gastos;
        const margen = ingresos > 0 ? (balance / ingresos) * 100 : 0;
        return { ingresos, gastos, balance, margen };
      };

      const cur = sumByType(monthMovs);
      const prev = sumByType(prevMovs);

      const variation = {
        ingresos: cur.ingresos - prev.ingresos,
        gastos: cur.gastos - prev.gastos,
        balance: cur.balance - prev.balance,
      };

      const summary = {
        month: thisMonth,
        ingresos: cur.ingresos,
        gastos: cur.gastos,
        balance: cur.balance,
        margen: cur.margen,
        variationVsPrev: variation,
      };

      // Top categorías del mes
      const catMap = new Map();
      for (const m of monthMovs) {
        const cat = keywordCategory(m.concept, m.category);
        catMap.set(cat, (catMap.get(cat) || 0) + Number(m.amount || 0));
      }
      const topCategories = Array.from(catMap.entries())
        .map(([category, total]) => ({ category, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 3);

      // Auditoría
      const audit = {
        missingCategory: monthMovs.filter((m) => !isNonEmptyString(m.category)).length,
        tooGeneralCategory: monthMovs.filter((m) => (m.category || "") === "General").length,
        genericConcept: monthMovs.filter((m) => {
          const t = normalizeText(m.concept);
          return t === "compra" || t === "venta" || t === "gasto" || t === "ingreso";
        }).length,
        possibleDuplicates: 0,
        invoiceMissing: monthMovs.filter(
          (m) => m.type === "Gasto" && !isNonEmptyString(m.invoiceNumber)
        ).length,
      };

      // Duplicados exactos (fecha+amount+concept)
      const dupSet = new Set();
      let dupCount = 0;
      for (const m of monthMovs) {
        const key = `${toYYYYMMDD(m.date)}|${Number(m.amount || 0)}|${normalizeText(m.concept)}`;
        if (dupSet.has(key)) dupCount += 1;
        else dupSet.add(key);
      }
      audit.possibleDuplicates = dupCount;

      // Anomalías
      const anomalies = [];

      // 1) Movimiento > 2.5x promedio de su categoría (mes)
      const catStats = new Map();
      for (const m of monthMovs) {
        const cat = keywordCategory(m.concept, m.category);
        const s0 = catStats.get(cat) || { sum: 0, n: 0 };
        s0.sum += Number(m.amount || 0);
        s0.n += 1;
        catStats.set(cat, s0);
      }
      for (const m of monthMovs) {
        const cat = keywordCategory(m.concept, m.category);
        const st = catStats.get(cat);
        if (!st || st.n < 3) continue;
        const avg = st.sum / st.n;
        if (avg > 0 && Number(m.amount || 0) > 2.5 * avg) {
          anomalies.push({
            title: "Movimiento inusual",
            message: `"${m.concept}" en ${cat} es muy alto vs tu promedio.`,
            movementId: m.id,
          });
        }
      }

      // 2) Duplicado exacto
      if (dupCount > 0) {
        anomalies.push({
          title: "Posibles duplicados",
          message: `Detectamos ${dupCount} movimiento(s) que parecen repetidos.`,
        });
      }

      // 3) Categoría nueva vs mes anterior
      const prevCats = new Set(prevMovs.map((m) => keywordCategory(m.concept, m.category)));
      const newCats = topCategories.map((x) => x.category).filter((c) => !prevCats.has(c));
      if (newCats.length > 0) {
        anomalies.push({
          title: "Categoría nueva",
          message: `Este mes apareció una categoría nueva: ${newCats[0]}.`,
        });
      }

      // 4) Pico semanal simple
      const weekMap = new Map();
      for (const m of monthMovs) {
        if (m.type !== "Gasto") continue;
        const d = new Date(m.date);
        const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0));
        const weekStart = new Date(day);
        const dow = (weekStart.getUTCDay() + 6) % 7; // lunes=0
        weekStart.setUTCDate(weekStart.getUTCDate() - dow);
        const key = `${toYYYYMMDD(weekStart)}`;
        weekMap.set(key, (weekMap.get(key) || 0) + Number(m.amount || 0));
      }
      const weeks = Array.from(weekMap.values());
      if (weeks.length >= 2) {
        const avgW = weeks.reduce((a, b) => a + b, 0) / weeks.length;
        const maxW = Math.max(...weeks);
        if (avgW > 0 && maxW > 1.8 * avgW) {
          anomalies.push({
            title: "Pico semanal",
            message: "Se detectó una semana con gastos anormalmente altos.",
          });
        }
      }

      // Health score 0–100
      let score = 50;
      if (cur.balance > 0) score += 15;
      if (cur.ingresos > 0 && cur.margen >= 20) score += 10;
      if (cur.ingresos > 0 && cur.margen < 0) score -= 15;
      if (variation.balance > 0) score += 8;
      if (audit.tooGeneralCategory > 3) score -= 8;
      if (audit.missingCategory > 0) score -= 6;
      if (audit.possibleDuplicates > 0) score -= 6;
      if (audit.invoiceMissing > 2) score -= 6;
      score = Math.max(0, Math.min(100, Math.round(score)));

      // Proyección 30/90 (promedio últimos 3 meses)
      const byMonth = new Map();
      for (const m of movements) {
        const mk = monthKeyUTC(m.date);
        if (!mk) continue;
        const prevM = byMonth.get(mk) || { ingresos: 0, gastos: 0 };
        const amt = Number(m.amount || 0);
        if (m.type === "Ingreso") prevM.ingresos += amt;
        else if (m.type === "Gasto") prevM.gastos += amt;
        byMonth.set(mk, prevM);
      }
      const monthsSorted = Array.from(byMonth.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([k, v]) => ({ month: k, ...v, balance: v.ingresos - v.gastos }));

      const last3 = monthsSorted.slice(-3);
      const avgBalance = last3.length
        ? last3.reduce((acc, x) => acc + x.balance, 0) / last3.length
        : 0;

      const projection30 = avgBalance;
      const projection90 = avgBalance * 3;

      // ==========================
      // SUGERENCIAS
      // ==========================
      const suggestions = [];
      const seenSug = new Set();
      const today = toYYYYMMDD(new Date());

      const hasActiveTaskLike = (kwOrList) => {
        const kws = Array.isArray(kwOrList) ? kwOrList : [kwOrList];
        const keys = kws.map(normalizeText).filter(Boolean);
        if (keys.length === 0) return false;

        return tasks.some((t) => {
          if (!t || t.status === "Completada") return false;
          const hay = normalizeText(`${t.title || ""} ${t.zone || ""}`);
          return keys.some((k) => hay.includes(k));
        });
      };

      const pushSug = (s) => {
        const key = `${s.code}|${s.title}|${s.message}`;
        if (seenSug.has(key)) return;
        seenSug.add(key);
        suggestions.push(s);
      };

      const topNorm = topCategories.map((x) => normalizeText(x.category));
      const topHas = (...names) => names.map(normalizeText).some((w) => topNorm.includes(w));

      if (monthMovs.length === 0) {
        pushSug({
          id: `FIN_BOOT_${thisMonth}`,
          code: "FIN_BOOT",
          title: "Activar finanzas del mes",
          message:
            "No hay movimientos registrados este mes. Agregá al menos 5 (ingresos y gastos) para que el análisis sea más preciso.",
          actionPayload: {
            title: "Registrar movimientos iniciales del mes",
            zone: "",
            type: "Mantenimiento",
            priority: "Alta",
            start: today,
            due: today,
            status: "Pendiente",
            owner: "",
          },
        });
      }

      if (audit.invoiceMissing > 0 && !hasActiveTaskLike(["factura", "recibo"])) {
        pushSug({
          id: `FIN_INVOICE_${thisMonth}`,
          code: "FIN_INVOICE_MISSING",
          title: "Completar facturas faltantes",
          message: `Hay ${audit.invoiceMissing} gasto(s) sin número de factura/recibo. Eso debilita control y auditoría.`,
          actionPayload: {
            title: "Completar facturas faltantes en gastos",
            zone: "",
            type: "Mantenimiento",
            priority: "Media",
            start: today,
            due: today,
            status: "Pendiente",
            owner: "",
          },
        });
      }

      if (
        (audit.missingCategory > 0 || audit.tooGeneralCategory > 0) &&
        !hasActiveTaskLike(["categoria", "categoría"])
      ) {
        pushSug({
          id: `FIN_CATS_${thisMonth}`,
          code: "FIN_FIX_CATEGORIES",
          title: "Ordenar categorías",
          message: `Tenés ${audit.missingCategory} sin categoría y ${audit.tooGeneralCategory} en "General". Clasificar mejora reportes y decisiones.`,
          actionPayload: {
            title: "Auditar categorías de movimientos",
            zone: "",
            type: "Mantenimiento",
            priority: "Media",
            start: today,
            due: today,
            status: "Pendiente",
            owner: "",
          },
        });
      }

      if (audit.possibleDuplicates > 0 && !hasActiveTaskLike(["duplicad", "repetid"])) {
        pushSug({
          id: `FIN_DUPS_${thisMonth}`,
          code: "FIN_DUPLICATES",
          title: "Revisar posibles duplicados",
          message: `Detectamos ${audit.possibleDuplicates} movimiento(s) posiblemente duplicados. Revisarlos evita distorsión del balance.`,
          actionPayload: {
            title: "Revisar duplicados en movimientos",
            zone: "",
            type: "Mantenimiento",
            priority: "Media",
            start: today,
            due: today,
            status: "Pendiente",
            owner: "",
          },
        });
      }

      if (cur.ingresos > 0 && cur.margen < 10 && !hasActiveTaskLike(["margen", "costos", "coste"])) {
        pushSug({
          id: `FIN_MARGIN_${thisMonth}`,
          code: "FIN_LOW_MARGIN",
          title: "Mejorar margen",
          message: `El margen del mes está en ${cur.margen.toFixed(1)}%. Recomendación: revisar costos silenciosos y renegociar insumos.`,
          actionPayload: {
            title: "Revisión de costos para mejorar margen",
            zone: "",
            type: "Mantenimiento",
            priority: "Alta",
            start: today,
            due: today,
            status: "Pendiente",
            owner: "",
          },
        });
      }

      if (topHas("transporte", "combustible") && !hasActiveTaskLike(["rutas", "combustible"])) {
        pushSug({
          id: `FIN_TRANSPORTE_${thisMonth}`,
          code: "FIN_HIGH_TRANSPORT",
          title: "Optimizar rutas",
          message:
            "Gasto alto en transporte/combustible. Recomendación: revisar rutas y recorridos para reducir costos.",
          actionPayload: {
            title: "Optimizar rutas y consumo de combustible",
            zone: "",
            type: "Mantenimiento",
            priority: "Media",
            start: today,
            due: today,
            status: "Pendiente",
            owner: "",
          },
        });
      }

      if (topHas("alimentacion", "alimentación") && !hasActiveTaskLike(["aliment"])) {
        pushSug({
          id: `FIN_ALIMENTACION_${thisMonth}`,
          code: "FIN_HIGH_FEED",
          title: "Revisar eficiencia de alimentación",
          message:
            "Gasto alto en alimentación. Recomendación: revisar consumo, desperdicio y calendario de suministro.",
          actionPayload: {
            title: "Revisar eficiencia de alimentación",
            zone: "",
            type: "Alimentación",
            priority: "Media",
            start: today,
            due: today,
            status: "Pendiente",
            owner: "",
          },
        });
      }

      if (topHas("fertilizantes", "abono", "fertiliz") && !hasActiveTaskLike(["fertiliz", "abono"])) {
        pushSug({
          id: `FIN_FERT_${thisMonth}`,
          code: "FIN_HIGH_FERT",
          title: "Optimizar plan de fertilización",
          message:
            "Inversión alta en fertilización. Recomendación: revisar dosis, calendario y necesidades por zona/cultivo.",
          actionPayload: {
            title: "Optimizar plan de fertilización por zona",
            zone: "",
            type: "Mantenimiento",
            priority: "Media",
            start: today,
            due: today,
            status: "Pendiente",
            owner: "",
          },
        });
      }

      if (topHas("venta", "ventas") && !hasActiveTaskLike(["ventas", "clientes", "producto"])) {
        pushSug({
          id: `FIN_SALES_${thisMonth}`,
          code: "FIN_SALES_ORDER",
          title: "Ordenar registro de ventas",
          message:
            "Ventas son top este mes. Recomendación: registrar ventas con mejor detalle (producto/cliente/canal) para medir rentabilidad real.",
          actionPayload: {
            title: "Mejorar detalle de registro de ventas",
            zone: "",
            type: "Mantenimiento",
            priority: "Media",
            start: today,
            due: today,
            status: "Pendiente",
            owner: "",
          },
        });
      }

      // 7) Conexión Mapa -> Finanzas -> Tareas
      for (const z of zones) {
        const zoneName = isNonEmptyString(z?.name) ? z.name.trim() : "";
        if (!zoneName) continue;

        const comp = z.components && typeof z.components === "object" ? z.components : {};
        const hasAnimals = !!(comp.animales || comp.animal || comp.animals || comp.ganado);
        const hasCrops = !!(comp.cultivos || comp.cultivo || comp.crops || comp.plantas);

        if (hasAnimals && topHas("sanidad") && !hasActiveTaskLike("sanidad")) {
          pushSug({
            id: `MAP_FIN_SANIDAD_${zoneName}_${thisMonth}`.slice(0, 180),
            code: "MAP_FIN_SANIDAD",
            title: `Chequeo sanitario (${zoneName})`,
            message: `Hay gasto relevante en Sanidad y la zona "${zoneName}" tiene animales. Recomendación: chequeo sanitario y control preventivo.`,
            actionPayload: {
              title: `Chequeo sanitario - ${zoneName}`,
              zone: zoneName,
              type: "Mantenimiento",
              priority: "Media",
              start: today,
              due: today,
              status: "Pendiente",
              owner: "",
            },
          });
        }

        if (hasCrops && topHas("fertilizantes") && !hasActiveTaskLike("fertiliz")) {
          pushSug({
            id: `MAP_FIN_FERT_${zoneName}_${thisMonth}`.slice(0, 180),
            code: "MAP_FIN_FERT",
            title: `Revisión nutricional (${zoneName})`,
            message: `Hay inversión en Fertilizantes y la zona "${zoneName}" tiene cultivos. Recomendación: revisión nutricional y plan por cultivo.`,
            actionPayload: {
              title: `Revisión nutricional - ${zoneName}`,
              zone: zoneName,
              type: "Mantenimiento",
              priority: "Media",
              start: today,
              due: today,
              status: "Pendiente",
              owner: "",
            },
          });
        }
      }

      return res.json({
        summary,
        topCategories,
        anomalies: anomalies.slice(0, 6),
        healthScore: score,
        projection30,
        projection90,
        audit,
        suggestions: suggestions.slice(0, 8),
      });
    } catch (err) {
      console.error("FINANCE_INSIGHTS_ERROR:", err);
      return res.status(500).json({ error: "Error generando insights financieros." });
    }
  });
}