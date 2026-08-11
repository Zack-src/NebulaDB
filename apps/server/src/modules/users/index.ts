import type { FastifyInstance } from "fastify";
import { registerAccountRoutes } from "./routes/account.js";
import { registerUserAdminRoutes } from "./routes/admin.js";

export function registerUserRoutes(app: FastifyInstance): void {
  registerAccountRoutes(app);
  registerUserAdminRoutes(app);
}
