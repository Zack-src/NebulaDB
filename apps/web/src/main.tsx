import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/index.css";
import "@xyflow/react/dist/style.css";
import { App } from "@/app/App";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { GlobalTooltip } from "@/components/overlays/Tooltip";
import { I18nProvider } from "@/i18n/I18nProvider";

/**
 * Canvas perf harness (`features/editor/bench`): the real editor over a
 * synthetic schema of a chosen size, no server behind it. Routed here rather
 * than inside `App` so it bypasses auth and project loading entirely, and
 * `lazy()` so it costs a normal session nothing — the chunk is only fetched
 * when someone opens `/#bench`. Rendered outside `StrictMode` on purpose: its
 * deliberate double-render would show up in every measurement.
 */
const BenchHarness = lazy(() => import("@/features/editor/bench/BenchHarness"));
const isBenchRoute = window.location.hash.startsWith("#bench");

const root = createRoot(document.getElementById("root")!);

root.render(
  isBenchRoute ? (
    <I18nProvider>
      <Suspense fallback={null}>
        <BenchHarness />
      </Suspense>
      <GlobalTooltip />
    </I18nProvider>
  ) : (
    <React.StrictMode>
      <I18nProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
        <GlobalTooltip />
      </I18nProvider>
    </React.StrictMode>
  ),
);
