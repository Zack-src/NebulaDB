<script lang="ts">
  import type { Snippet } from "svelte";
  import { i18n } from "@/i18n/i18n.svelte";
  import { reportClientError } from "@/services/errorsApi";

  /**
   * The app previously had no error boundary at all: any exception thrown
   * during render — a malformed entity arriving over the WebSocket from a
   * collaborator, a plugin command writing something unexpected into the
   * shared doc, a plain bug — tore the whole tree down and left a blank page
   * with no message and no way out but a manual reload. That is worst in the
   * editor, i.e. exactly where the user has unsaved attention invested.
   */
  let {
    children,
    title,
    onReset,
    resetLabel,
  }: {
    children: Snippet;
    /**
     * Shown above the error details. The editor sets its own so a crash there
     * doesn't read like the whole app died — the user's other projects are fine.
     */
    title?: string;
    /**
     * Rendered as a secondary action when present — the editor passes "back to
     * the project list", which recovers without a full reload (and without
     * re-entering the document that just crashed).
     */
    onReset?: () => void;
    resetLabel?: string;
  } = $props();

  const { t } = i18n;

  function handleError(error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[athanordb] render error:", err);
    // Best-effort report to the server-side error log. Never awaited and never
    // lets a reporting failure surface here: this handler is already deep in
    // "something went wrong", and a rejected fetch (offline, logged out,
    // server down) must not compound it. A pre-login crash reports nothing —
    // the endpoint requires a session — which is fine: nobody is signed in yet
    // to have caused a schema-shaped bug.
    reportClientError({
      message: err.message || String(err),
      stack: err.stack,
      context: `${window.location.pathname}${window.location.hash} :: ${err.stack?.split("\n")[1]?.trim() ?? ""}`,
    }).catch(() => {});
  }

  function messageOf(error: unknown): string {
    return error instanceof Error ? error.message || String(error) : String(error);
  }
</script>

<svelte:boundary onerror={handleError}>
  {@render children()}

  {#snippet failed(error, reset)}
    <div class="min-h-screen w-full flex items-center justify-center p-6 bg-bg text-text">
      <div class="max-w-lg w-full rounded-xl border border-danger/40 bg-surface p-6 shadow-lg">
        <h1 class="text-lg font-bold mb-2">{title ?? t("errorBoundary.title")}</h1>
        <p class="text-xs text-text-secondary leading-relaxed mb-4">{t("errorBoundary.body")}</p>
        <pre
          class="text-[11px] font-mono bg-bg border border-border rounded-lg p-3 mb-5 overflow-x-auto whitespace-pre-wrap break-words text-danger">{messageOf(
            error,
          )}</pre>
        <div class="flex flex-wrap gap-2">
          <button
            onclick={() => window.location.reload()}
            class="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:opacity-90 transition-opacity"
          >
            {t("errorBoundary.reload")}
          </button>
          {#if onReset}
            <button
              onclick={() => {
                onReset?.();
                reset();
              }}
              class="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:border-primary transition-colors"
            >
              {resetLabel ?? t("errorBoundary.goBack")}
            </button>
          {/if}
        </div>
      </div>
    </div>
  {/snippet}
</svelte:boundary>
