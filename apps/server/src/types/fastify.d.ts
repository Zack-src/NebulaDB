import type { SessionUser } from "../modules/auth/session.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionUser | null;
  }
}
