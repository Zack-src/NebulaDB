import type { FastifyInstance } from "fastify";
import { describeDbmlParseError, parseSql, projectToDbml, toProject } from "@athanordb/dbml-engine";
import { ApiError } from "../../shared/errors.js";
import { requireUser } from "../../shared/guards.js";
import { isSqlDialect, SQL_DIALECTS } from "../../shared/sqlDialect.js";

/**
 * Stateless SQL DDL -> DBML conversion, touching no project.
 *
 * Exists so that *every* importer — the built-in SQL ones and any user plugin
 * — can hand the app plain DBML: the plugin API deliberately makes DBML the
 * single import currency (see `features/plugins/types.ts`), and the SQL parser
 * lives server-side in `@dbml/core`, which is far too large to ship to the
 * browser just so a built-in importer can match the plugin contract.
 */
export function registerConvertRoutes(app: FastifyInstance): void {
  app.post("/api/convert/to-dbml", async (req) => {
    requireUser(req);

    const body = (req.body ?? {}) as { source?: string; dialect?: string };
    if (!body.source?.trim()) throw new ApiError("SOURCE_REQUIRED");
    if (!isSqlDialect(body.dialect)) {
      throw new ApiError("SQL_DIALECT_INVALID", { message: `dialect must be one of ${SQL_DIALECTS.join(", ")}` });
    }

    try {
      const database = parseSql(body.source, body.dialect);
      return { dbml: projectToDbml(toProject(database, "Imported", body.source)) };
    } catch (err) {
      const info = describeDbmlParseError(err);
      throw new ApiError("SQL_PARSE_FAILED", {
        message: `SQL parse error: ${info.message}`,
        details: info as unknown as Record<string, unknown>,
      });
    }
  });
}
