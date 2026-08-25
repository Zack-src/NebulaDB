import type { SessionUser } from "../modules/auth/session.js";
import type { ApiKeyContext } from "../modules/apiKeys/auth.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionUser | null;
    /** Set only when this request authenticated via an `Authorization: Bearer` API key rather than a session cookie. */
    apiKey?: ApiKeyContext | null;
  }
}
