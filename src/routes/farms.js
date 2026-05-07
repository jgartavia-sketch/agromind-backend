// src/routes/farms.js
import { createFarmsContext, registerBaseRoutes } from "./farms.base.js";
import { registerTaskRoutes } from "./farms.tasks.js";
import { registerFinanceRoutes } from "./farms.finance.js";
import { registerZonesReportRoutes } from "./farms.zonesReport.js";
import processesRouter from "./processes.js";

export default function farmsRouter(prisma) {
  const ctx = createFarmsContext(prisma);

  // =====================================================
  // Orden lógico:
  // base -> tareas -> finanzas -> reporte -> procesos
  // =====================================================
  registerBaseRoutes(ctx);
  registerTaskRoutes(ctx);
  registerFinanceRoutes(ctx);
  registerZonesReportRoutes(ctx);

  // ✅ Gestor de procesos
  ctx.router.use("/processes", processesRouter(prisma));

  return ctx.router;
}