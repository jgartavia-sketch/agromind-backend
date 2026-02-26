// src/routes/farms.js
import { createFarmsContext, registerBaseRoutes } from "./farms.base.js";
import { registerTaskRoutes } from "./farms.tasks.js";
import { registerFinanceRoutes } from "./farms.finance.js";
import { registerZonesReportRoutes } from "./farms.zonesReport.js";

export default function farmsRouter(prisma) {
  const ctx = createFarmsContext(prisma);

  // Orden lógico: base -> tareas -> finanzas -> reporte
  registerBaseRoutes(ctx);
  registerTaskRoutes(ctx);
  registerFinanceRoutes(ctx);
  registerZonesReportRoutes(ctx);

  return ctx.router;
}