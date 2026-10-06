import {
  generateRows,
  type GeneratedRows,
  type GeneratorContext,
  type Table,
  type TableGeneratorConfig,
} from "@nebuladb/shared";
import { ApiError } from "../../shared/errors.js";

/**
 * Where generated rows come from. `builtin` (the seeded generator in
 * `@nebuladb/shared`) is the only one today; another — an AI service, say —
 * registers here without the routes changing.
 *
 * The contract every provider keeps: it receives the table's **structure
 * only** — never a row of a real database (parent keys come from the
 * project's own seeds) — and whatever it returns is validated by the same
 * seed checks as a hand-made CSV before it can be saved or deployed.
 */
export interface DataGeneratorProvider {
  id: string;
  generate(request: {
    table: Table;
    config: TableGeneratorConfig;
    context: GeneratorContext;
    /** Free-text guidance for providers that take it; `builtin` ignores it. */
    hints?: string;
  }): Promise<GeneratedRows>;
}

const builtin: DataGeneratorProvider = {
  id: "builtin",
  generate: async ({ table, config, context }) => generateRows(table, config, context),
};

const providers = new Map<string, DataGeneratorProvider>([[builtin.id, builtin]]);

/** Adds a provider. Enabling one for an instance or a project is the caller's decision — nothing here turns it on. */
export function registerDataGeneratorProvider(provider: DataGeneratorProvider): void {
  providers.set(provider.id, provider);
}

export function getDataGeneratorProvider(id = "builtin"): DataGeneratorProvider {
  const provider = providers.get(id);
  if (!provider) throw new ApiError("GENERATOR_INVALID", { message: `unknown generator provider: ${id}` });
  return provider;
}
