import { mount } from "svelte";
import "@/styles/index.css";
import "@xyflow/svelte/dist/style.css";
import { migrateBrandStorage } from "@/utils/brandMigration";

try {
  migrateBrandStorage(localStorage);
} catch {
  // A browser that blocks storage can still open the application.
}

// Load preference readers only after historical keys have been copied. A share
// link's page (`/share/<token>`) is its own small root: it must not start the
// app, which checks the session and talks to the authenticated API.
const root = window.location.pathname.startsWith("/share/")
  ? import("@/features/share/ShareRoot.svelte")
  : import("@/app/Root.svelte");

void root.then(({ default: Root }) => {
  mount(Root, { target: document.getElementById("root")! });
});
