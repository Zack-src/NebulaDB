import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { GlobalTooltip } from "./Tooltip.js";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <GlobalTooltip />
  </React.StrictMode>,
);
