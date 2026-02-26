// src/routes/farms.zonesReport.js
export function registerZonesReportRoutes(ctx) {
  const { prisma, router, requireAuth, looksLikeId, isNonEmptyString, normalizeText, assertFarmOwner } =
    ctx;

  // GET /api/farms/:id/zones/report
  router.get("/farms/:id/zones/report", requireAuth, async (req, res) => {
    try {
      const farmId = req.params.id;
      const userId = req.user.id;

      if (!looksLikeId(farmId)) return res.status(400).json({ error: "farmId inválido." });

      const farm = await assertFarmOwner(farmId, userId);
      if (!farm) return res.status(403).json({ error: "Sin acceso a esa finca." });

      const [zones, tasks] = await Promise.all([
        prisma.mapZone.findMany({
          where: { farmId },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            components: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.task.findMany({
          where: { farmId },
          select: { id: true, title: true, zone: true, status: true, due: true, priority: true, type: true },
        }),
      ]);

      const tasksActive = tasks.filter((t) => t && t.status !== "Completada");
      const norm = (s) => normalizeText(s || "");

      const report = zones.map((z) => {
        const zoneName = isNonEmptyString(z?.name) ? z.name.trim() : "";
        const zn = norm(zoneName);

        const zoneTasks = tasksActive.filter((t) => norm(t.zone) === zn);

        // componentes: dejamos el objeto tal cual, pero también damos un “resumen” usable
        const c = z.components && typeof z.components === "object" ? z.components : {};
        const hasAnimals = !!(c.animales || c.animal || c.animals || c.ganado);
        const hasCrops = !!(c.cultivos || c.cultivo || c.crops || c.plantas);

        return {
          id: z.id,
          name: zoneName,
          updatedAt: z.updatedAt,
          createdAt: z.createdAt,
          components: c,
          componentsSummary: {
            hasAnimals,
            hasCrops,
            keys: Object.keys(c || {}).slice(0, 30),
          },
          activeTasksCount: zoneTasks.length,
          activeTasks: zoneTasks
            .sort((a, b) => String(a.due || "").localeCompare(String(b.due || "")))
            .slice(0, 12),
        };
      });

      return res.json({
        ok: true,
        farm: { id: farm.id, name: farm.name },
        zonesCount: zones.length,
        activeTasksCount: tasksActive.length,
        report,
      });
    } catch (err) {
      console.error("ZONES_REPORT_ERROR:", err);
      return res.status(500).json({ error: "Error generando reporte de zonas." });
    }
  });
}