import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/i18n/useTranslation";
import { describeApiError } from "@/i18n/serverErrorMessages";

export interface AsyncResource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Re-runs the fetch — pass to a retry button or call after a mutation. */
  reload: () => void;
  setError: (message: string | null) => void;
}

/**
 * Fetch-on-mount with loading and (translated) error state.
 *
 * Six components had their own `refresh()` doing exactly this, each formatting
 * failures its own way — which is how English server messages ended up on
 * screen in a French UI. Errors go through `describeApiError`, so every screen
 * reports a failure the same way and in the reader's language.
 */
export function useAsyncResource<T>(fetcher: () => Promise<T>, deps: unknown[] = []): AsyncResource<T> {
  const { t } = useTranslation();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for the fetch this same effect kicks off
    setLoading(true);
    fetcher()
      .then((result) => {
        if (!active) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        // A resolved-after-unmount response must not call setState, and a
        // superseded request must not overwrite the current one's result.
        if (active) setError(describeApiError(err, t));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // `fetcher` is intentionally not a dependency: callers pass an inline
    // closure, which would be a new reference every render and refetch forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken, t, ...deps]);

  return { data, loading, error, reload, setError };
}
