/**
 * Loads `.env` into `process.env` before anything else. Must stay the *first* import in
 * `index.ts` so `config.ts` sees the values. Uses `process.loadEnvFile`, no `dotenv`;
 * silently does nothing without a `.env`.
 */
try {
  process.loadEnvFile();
} catch (err) {
  if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
}
