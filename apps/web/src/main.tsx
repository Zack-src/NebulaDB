import React from "react";
import { createRoot } from "react-dom/client";
import "@/styles/index.css";
import { App } from "@/app/App";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { GlobalTooltip } from "@/components/overlays/Tooltip";
import { I18nProvider } from "@/i18n/I18nProvider";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
      <GlobalTooltip />
    </I18nProvider>
  </React.StrictMode>,
);
