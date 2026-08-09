import { Component, type ErrorInfo, type ReactNode } from "react";

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
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // No error-reporting service is wired up (tracked in todo.md Phase 24), so
    // the console is the only sink. Log the component stack too — for a crash
    // inside the canvas the stack trace alone rarely identifies which node.
    console.error("[athanordb] render error:", error, info.componentStack);
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
          <h1 className="text-lg font-bold mb-2">{this.props.title ?? "Une erreur inattendue s'est produite"}</h1>
          <p className="text-xs text-text-secondary leading-relaxed mb-4">
            L'interface s'est arrêtée pour éviter d'afficher un état incohérent. Vos données ne sont pas perdues : le
            schéma est enregistré côté serveur, y compris les modifications faites juste avant l'erreur.
          </p>
          <pre className="text-[11px] font-mono bg-bg border border-border rounded-lg p-3 mb-5 overflow-x-auto whitespace-pre-wrap break-words text-danger">
            {error.message || String(error)}
          </pre>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:opacity-90 transition-opacity"
            >
              Recharger la page
            </button>
            {this.props.onReset && (
              <button
                onClick={this.reset}
                className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:border-primary transition-colors"
              >
                {this.props.resetLabel ?? "Revenir en arrière"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
