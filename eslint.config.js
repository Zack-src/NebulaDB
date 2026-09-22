// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/data/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      complexity: ["error", 40],
    },
  },
  {
    // @dbml/core doesn't export usable types for its raw parsed Database
    // model (Table/Field/Ref internals) — these two spots deliberately bridge
    // that untyped boundary into AthanorDB's own typed `Project` shape.
    files: ["packages/dbml-engine/src/dbml.ts", "apps/server/src/routes/projects.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Benchmark/automation drivers: Node scripts whose `page.evaluate`
    // callbacks are serialized and run inside the browser, so they legitimately
    // reference `window`/`document` from a Node file.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  ...svelte.configs.recommended,
  {
    files: ["apps/web/**/*.{ts,svelte}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      // Every plain Map/Set this rule flags is a scratch index built and read
      // inside one derivation or event handler, never stored as state — the
      // reactive versions would only add tracking cost on the canvas hot path.
      "svelte/prefer-svelte-reactivity": "off",
    },
  },
  {
    // `.svelte` files (and rune-bearing `.svelte.ts` modules) run their
    // `<script lang="ts">` through typescript-eslint's parser.
    files: ["apps/web/**/*.svelte", "apps/web/**/*.svelte.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: [".svelte"],
        parser: tseslint.parser,
      },
    },
  },
  {
    // Guard against the UI drifting back to hard-coded copy. Every user-facing
    // string goes through `t()` and lives in src/locales; a bare sentence in
    // markup is one that can never be translated. Four-letter minimum so
    // separators, punctuation and short code identifiers don't trip it.
    files: ["apps/web/src/**/*.svelte"],
    ignores: ["apps/web/src/locales/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "SvelteText[value=/[A-Za-zÀ-ÿ]{4,}/]",
          message: "Hard-coded UI text. Add the string to src/locales/fr.json + en.json and render it with t('key').",
        },
      ],
    },
  },
  eslintConfigPrettier,
);
