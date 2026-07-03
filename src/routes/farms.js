// src/routes/farms.js

import { createFarmsContext, registerBaseRoutes } from "./farms.base.js";
import { registerTaskRoutes } from "./farms.tasks.js";
import { registerFinanceRoutes } from "./farms.finance.js";
import { registerZonesReportRoutes } from "./farms.zonesReport.js";

import processesRouter from "./processes.js";
import componentPhotosRouter from "./componentPhotos.js";

export default function farmsRouter(prisma) {
  const ctx = createFarmsContext(prisma);

  registerBaseRoutes(ctx);
  registerTaskRoutes(ctx);
  registerFinanceRoutes(ctx);
  registerZonesReportRoutes(ctx);

  // Procesos
  ctx.router.use("/processes", processesRouter(prisma));

  // Fotos de componentes
  ctx.router.use("/component-photos", componentPhotosRouter(prisma));

  return ctx.router;
}