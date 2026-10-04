// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

const HARD_CODED_TEXT = {
  selector: "SvelteText[value=/[A-Za-zÀ-ÿ]{4,}/]",
  message: "Hard-coded UI text. Add the string to src/locales/fr.json + en.json and render it with t('key').",
};

/**
 * Feature files that still use a native `<select>` or checkbox / radio /
 * number `<input>` (docs/todo.md, Phase 29 "Forbid native controls"). The list
 * only ever shrinks: migrate a file to `components/ui/`, delete its line. A new
 * file is never added here.
 */
const NATIVE_CONTROLS_NOT_MIGRATED = [
  "admin/AuditTab.svelte",
  "auth/Login.svelte",
  "editor/compare/CompareProjectsModal.svelte",
  "editor/edges/EdgeSettingsPopover.svelte",
  "editor/io/ExportDialog.svelte",
  "editor/io/ImportDialog.svelte",
  "editor/nodes/table/AddIndexForm.svelte",
  "editor/nodes/table/FieldEditorPanel.svelte",
  "plugins/dialog/InstalledTab.svelte",
  "plugins/dialog/MarketplaceTab.svelte",
  "plugins/dialog/PluginSettingsModal.svelte",
  "plugins/dialog/StudioTab.svelte",
].map((file) => `apps/web/src/features/${file}`);

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
      "no-restricted-syntax": ["error", HARD_CODED_TEXT],
    },
  },
  {
    // Screens are built from `components/ui/`, not from the browser's own
    // controls: a native `<select>` or checkbox looks different on every
    // platform and cannot carry an icon, a search field or an indeterminate
    // state. `components/` itself is exempt — that is where the native element
    // is wrapped. Flat config replaces a rule's options rather than merging
    // them, so the hard-coded-text selector is repeated here.
    files: ["apps/web/src/features/**/*.svelte"],
    ignores: NATIVE_CONTROLS_NOT_MIGRATED,
    rules: {
      "no-restricted-syntax": [
        "error",
        HARD_CODED_TEXT,
        {
          selector: "SvelteElement[name.name='select']",
          message: "Native <select>. Use Select from @/components/ui/Select.svelte.",
        },
        {
          selector:
            "SvelteElement[name.name='input'] > SvelteStartTag > SvelteAttribute[key.name='type'] > SvelteLiteral[value=/^(checkbox|radio|number)$/]",
          message:
            "Native checkbox / radio / number input. Use Checkbox, Switch, RadioGroup, SegmentedControl or NumberInput from @/components/ui/.",
        },
      ],
    },
  },
  eslintConfigPrettier,
);
