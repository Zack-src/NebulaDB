import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/**
 * Svelte strips TypeScript from `<script lang="ts">` natively; the preprocessor
 * is only here so a component's own `<style>` block (and any TS syntax the
 * native stripper doesn't cover) goes through the same Vite pipeline as the
 * rest of the app.
 */
export default {
  preprocess: vitePreprocess(),
};
