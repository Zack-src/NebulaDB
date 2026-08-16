/**
 * Shared "is the throwaway test container up?" message for the
 * postgres/mysql driver tests (see ../../../../../docker-compose.test.yml).
 * Kept out of the `.test.ts` files themselves so it isn't picked up by
 * `node --test`.
 */
export const TEST_DB_HINT =
  "start it with `docker compose -f docker-compose.test.yml up -d` from the repo root, then re-run the tests";
