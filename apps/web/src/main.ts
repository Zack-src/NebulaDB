import { mount } from "svelte";
import "@/styles/index.css";
import "@xyflow/svelte/dist/style.css";
import { migrateBrandStorage } from "@/utils/brandMigration";

try {
  migrateBrandStorage(localStorage);
} catch {
  // A browser that blocks storage can still open the application.
}

// Load preference readers only after historical keys have been copied.
void import("@/app/Root.svelte").then(({ default: Root }) => {
  mount(Root, { target: document.getElementById("root")! });
});
