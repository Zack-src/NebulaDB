import { useCallback, useState } from "react";
import { useTranslation } from "@/i18n/useTranslation";
import { describeApiError } from "@/i18n/serverErrorMessages";

export interface AsyncActionHandle<Args extends unknown[]> {
  run: (...args: Args) => Promise<boolean>;
  pending: boolean;
  error: string | null;
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (...args: Args) => {
      setPending(true);
      setError(null);
      try {
        await action(...args);
        return true;
      } catch (err) {
        setError(describeApiError(err, t));
        return false;
      } finally {
        setPending(false);
      }
    },
    [action, t],
  );

  return { run, pending, error, clearError: useCallback(() => setError(null), []) };
}
