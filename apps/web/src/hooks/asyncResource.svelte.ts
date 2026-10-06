import { useTranslation } from "@/i18n/i18n.svelte";
import { describeApiError } from "@/i18n/serverErrorMessages";

export interface AsyncResource<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: string | null;
  /** Re-runs the fetch — pass to a retry button or call after a mutation. */
  reload: () => void;
  setError: (message: string | null) => void;
}

/**
 * Fetch-on-mount with loading and translated error state, so every screen reports failures the
 * same way and in the reader's language (`describeApiError`). Dependencies are tracked
 * automatically: whatever reactive value `fetcher` reads synchronously re-runs the fetch.
 */
export function useAsyncResource<T>(fetcher: () => Promise<T>): AsyncResource<T> {
  const { t } = useTranslation();
  let data = $state.raw<T | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let reloadToken = $state(0);

  $effect(() => {
    void reloadToken;
    let active = true;
    loading = true;
    fetcher()
      .then((result) => {
        if (!active) return;
        data = result;
        error = null;
      })
      .catch((err: unknown) => {
        // A resolved-after-destroy response must not write state, and a
        // superseded request must not overwrite the current one's result.
        if (active) error = describeApiError(err, t);
      })
      .finally(() => {
        if (active) loading = false;
      });
    return () => {
      active = false;
    };
  });

  return {
    get data() {
      return data;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    reload: () => {
      reloadToken += 1;
    },
    setError: (message) => {
      error = message;
    },
  };
}
