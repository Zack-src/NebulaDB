import { Component, type ErrorInfo, type ReactNode } from "react";
import { I18nContext, type I18nContextValue } from "@/i18n/I18nProvider";
import { reportClientError } from "@/services/errorsApi";
import fr from "@/locales/fr.json";

interface ErrorBoundaryProps {
  children: ReactNode;
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
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * The app previously had no error boundary at all: any exception thrown during
 * render — a malformed entity arriving over the WebSocket from a collaborator,
 * a plugin command writing something unexpected into the shared doc, a plain
 * bug — unmounted the whole React tree and left a blank white page with no
 * message and no way out but a manual reload. That is worst in the editor,
 * i.e. exactly where the user has unsaved attention invested.
 *
 * Kept as a class because that is still the only way to implement
 * `componentDidCatch`; there is no hook equivalent.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  // Class components can't call `useTranslation`, and `contextType` is the only
  // way to reach the dictionary from one. The French fallback covers the outer
  // boundary, which deliberately sits outside the provider so a crash in the
  // provider itself still renders something.
  static contextType = I18nContext;
  declare context: I18nContextValue | null;

  state: ErrorBoundaryState = { error: null };

  private translate = (key: keyof typeof fr): string => this.context?.t(key) ?? fr[key];

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log the component stack too — for a crash inside the canvas the stack
    // trace alone rarely identifies which node.
    console.error("[athanordb] render error:", error, info.componentStack);
    // Best-effort report to the server-side error log (`docs/todo.md` Phase
    // 24 — there was previously nowhere for this to go). Never awaited and
    // never lets a reporting failure surface here: this handler is already
    // deep in "something went wrong", and a rejected fetch (offline, logged
    // out, server down) must not compound it. A pre-login crash reports
    // nothing — the endpoint requires a session — which is fine: nobody is
    // signed in yet to have caused a schema-shaped bug.
    reportClientError({
      message: error.message || String(error),
      stack: error.stack,
      context: `${window.location.pathname}${window.location.hash} :: ${info.componentStack?.trim().split("\n")[0] ?? ""}`,
    }).catch(() => {});
  }

  private reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen w-full flex items-center justify-center p-6 bg-bg text-text">
        <div className="max-w-lg w-full rounded-xl border border-danger/40 bg-surface p-6 shadow-lg">
          <h1 className="text-lg font-bold mb-2">{this.props.title ?? this.translate("errorBoundary.title")}</h1>
          <p className="text-xs text-text-secondary leading-relaxed mb-4">{this.translate("errorBoundary.body")}</p>
          <pre className="text-[11px] font-mono bg-bg border border-border rounded-lg p-3 mb-5 overflow-x-auto whitespace-pre-wrap break-words text-danger">
            {error.message || String(error)}
          </pre>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:opacity-90 transition-opacity"
            >
              {this.translate("errorBoundary.reload")}
            </button>
            {this.props.onReset && (
              <button
                onClick={this.reset}
                className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:border-primary transition-colors"
              >
                {this.props.resetLabel ?? this.translate("errorBoundary.goBack")}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
