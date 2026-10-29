import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { ApiError } from "./errors.js";

/**
 * Why zod: Fastify's native route schemas (JSON Schema + ajv) validate at
 * runtime but give handlers no static types, which is exactly the gap the
 * `req.body as {...}` casts paper over. A zod schema is both the runtime check
 * and the source of the TypeScript type (`z.infer`), needs no plugin or type
 * provider wiring, can emit JSON Schema (`z.toJSONSchema`) for OpenAPI, and
 * is already in the lockfile through packages/mcp.
 */
export { z };

export interface InvalidField {
  /** Dotted path of the offending field, e.g. `tableIds.2`; empty for the body itself. */
  path: string;
  /** Zod's issue code (`invalid_type`, `too_big`, …) — never the offending value. */
  issue: string;
  /** Present for type mismatches: the type the field should have. */
  expected?: string;
}

function describeIssues(error: z.ZodError): InvalidField[] {
  return error.issues.map((issue) => {
    const field: InvalidField = { path: issue.path.map(String).join("."), issue: issue.code };
    if (issue.code === "invalid_type") field.expected = issue.expected;
    return field;
  });
}

/**
 * Parses `input` with `schema` or throws `VALIDATION_FAILED` (400) listing the
 * invalid fields. Only paths and issue kinds are reported, never values or
 * zod's own messages: a rejected body may hold a password or an API secret,
 * and it must not come back in a response or a log line.
 */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ApiError("VALIDATION_FAILED", { details: { fields: describeIssues(result.error) } });
}

/** A missing body is an empty one: handlers have always treated "no body" as "no fields". */
export function parseBody<S extends z.ZodType>(schema: S, req: FastifyRequest): z.infer<S> {
  return parseInput(schema, req.body ?? {});
}

export function parseQuery<S extends z.ZodType>(schema: S, req: FastifyRequest): z.infer<S> {
  return parseInput(schema, req.query ?? {});
}

export function parseParams<S extends z.ZodType>(schema: S, req: FastifyRequest): z.infer<S> {
  return parseInput(schema, req.params ?? {});
}

/** Route params shared by every `/:id` route. */
export const idParams = z.object({ id: z.string() });

/** Route params made only of plain string segments, e.g. paramsOf("id", "hookId"). */
export function paramsOf<K extends string>(...keys: K[]) {
  return z.object(Object.fromEntries(keys.map((k) => [k, z.string()])) as Record<K, z.ZodString>);
}
