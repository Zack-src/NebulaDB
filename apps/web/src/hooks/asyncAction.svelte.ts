import { useTranslation } from "@/i18n/i18n.svelte";
import { describeApiError } from "@/i18n/serverErrorMessages";

export interface AsyncActionHandle<Args extends unknown[]> {
  run: (...args: Args) => Promise<boolean>;
  readonly pending: boolean;
  readonly error: string | null;
  clearError: () => void;
}

/**
 * Wraps a one-shot mutation (submit, delete, invite) with pending and error
 * state. `run` resolves `true` on success and `false` on failure, so a caller
 * can close its dialog without repeating the try/catch:
 *
 *   if (await save.run(name)) onClose();
 */
export function useAsyncAction<Args extends unknown[]>(
  action: (...args: Args) => Promise<unknown>,
): AsyncActionHandle<Args> {
  const { t } = useTranslation();
  let pending = $state(false);
  let error = $state<string | null>(null);

  return {
    get pending() {
      return pending;
    },
    get error() {
      return error;
    },
    run: async (...args: Args) => {
      pending = true;
      error = null;
      try {
        await action(...args);
        return true;
      } catch (err) {
        error = describeApiError(err, t);
        return false;
      } finally {
        pending = false;
      }
    },
    clearError: () => {
      error = null;
    },
  };
}
