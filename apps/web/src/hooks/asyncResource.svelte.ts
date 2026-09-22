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
 * Fetch-on-mount with loading and (translated) error state.
 *
 * Six components had their own `refresh()` doing exactly this, each formatting
 * failures its own way — which is how English server messages ended up on
 * screen in a French UI. Errors go through `describeApiError`, so every screen
 * reports a failure the same way and in the reader's language.
 *
 * Dependencies are tracked automatically: whatever reactive value `fetcher`
 * reads synchronously (a prop, a filter select's state) re-runs the fetch when
 * it changes — what the explicit `deps` array used to spell out.
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
