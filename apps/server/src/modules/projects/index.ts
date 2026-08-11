import type { FastifyInstance } from "fastify";
import { registerProjectCrudRoutes } from "./routes/crud.js";
import { registerProjectImportExportRoutes } from "./routes/importExport.js";
import { registerProjectRevisionRoutes } from "./routes/revisions.js";
import { registerProjectTeamRoutes } from "./routes/teams.js";

export function registerProjectRoutes(app: FastifyInstance): void {
  registerProjectCrudRoutes(app);
  registerProjectTeamRoutes(app);
  registerProjectRevisionRoutes(app);
  registerProjectImportExportRoutes(app);
}
