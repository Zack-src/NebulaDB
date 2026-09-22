/**
 * Loads `.env` (if present) into `process.env` before anything else in the
 * module graph runs. Must stay the *first* import in `index.ts` — ESM
 * evaluates a module's imports in source order, depth-first, so as long as
 * this has no imports of its own, it's guaranteed to finish before
 * `config.ts` (or anything else `index.ts` imports) does its own
 * `process.env.X` reads at module-eval time.
 *
 * `process.loadEnvFile` (stable since Node 20.12/22) rather than the `dotenv`
 * package — one less dependency for something Node now does natively.
 * Silently does nothing if `.env` doesn't exist: production deployments that
 * set real environment variables shouldn't need one.
 */
try {
  process.loadEnvFile();
} catch (err) {
  if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
}
