// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

const HARD_CODED_TEXT = {
  selector: "SvelteText[value=/[A-Za-zÀ-ÿ]{4,}/]:not(SvelteStyleElement > SvelteText)",
  message: "Hard-coded UI text. Add the string to src/locales/fr.json + en.json and render it with t('key').",
};

/**
 * Font sizes come from the type scale (`text-micro` … `text-heading`, tokens.css), never from an
 * arbitrary `text-[13px]`: one scale is what keeps the screens the same size as each other.
 */
const FONT_SIZE_MESSAGE = "Arbitrary font size. Use the type scale: text-micro, text-caption, text-label, text-body-sm, text-body, text-title or text-heading.";
const ARBITRARY_FONT_SIZE = [
  { selector: "SvelteLiteral[value=/text-\\[[0-9.]+px\\]/]", message: FONT_SIZE_MESSAGE },
  { selector: "Literal[value=/text-\\[[0-9.]+px\\]/]", message: FONT_SIZE_MESSAGE },
  { selector: "TemplateElement[value.raw=/text-\\[[0-9.]+px\\]/]", message: FONT_SIZE_MESSAGE },
];

/**
 * Feature files that still write their own `<table>` — data grids, previews and editable grids the
 * page `Table` (components/ui/Table.svelte) is not meant for. Same rule as below: the list only
 * shrinks, a new file is never added.
 */
const RAW_TABLE_RESTRICTION = {
  elements: ["table"],
  message: "Raw <table>. Use Table from @/components/ui/Table.svelte.",
};
const RAW_INPUT_RESTRICTION = {
  elements: ["input"],
  message: "Raw <input>. Use Input from @/components/ui/Input.svelte.",
};

const RAW_TABLE_NOT_MIGRATED = [
  "connections/console/ExplorerPanel.svelte",
  "connections/console/HealthPanel.svelte",
  "connections/console/JournalPanel.svelte",
  "connections/console/UsersPanel.svelte",
  "editor/dictionary/DictionaryPanel.svelte",
  "editor/seeds/GeneratePanel.svelte",
  "editor/seeds/SeedDialog.svelte",
  "share/SharedDictionary.svelte",
  "workspace/variants/ProjectDiffList.svelte",
].map((file) => `apps/web/src/features/${file}`);

/**
 * Feature files that still use a raw `<input>`: hidden file pickers, canvas fields that carry their
 * own editing classes, and the palettes. Text fields everywhere else are `Input`
 * (components/ui/Input.svelte). The list only shrinks.
 */
const RAW_INPUT_NOT_MIGRATED = [
  "connections/form/ConnectionSecurityFields.svelte",
  "editor/canvas/CanvasSearchPanel.svelte",
  "editor/dbml/CommandPalette.svelte",
  "editor/dbml/DbmlEditor/RenamePopover.svelte",
  "editor/io/ImportDialog.svelte",
  "editor/nodes/table/InlineNameInput.svelte",
  "editor/seeds/SeedDialog.svelte",
  "palette/GlobalPalette.svelte",
  "plugins/dialog/InstalledTab.svelte",
  "plugins/dialog/MarketplaceTab.svelte",
  "plugins/dialog/PluginSettingsModal.svelte",
  "plugins/dialog/StudioTab.svelte",
  "plugins/PluginManagerDialog.svelte",
  "plugins/PluginQuickPalette.svelte",
].map((file) => `apps/web/src/features/${file}`);

/**
 * Feature files that still use a native `<select>` or checkbox / radio /
 * number `<input>` (docs/todo.md, Phase 29 "Forbid native controls"). The list
 * only ever shrinks: migrate a file to `components/ui/`, delete its line. A new
 * file is never added here.
 */
const NATIVE_CONTROLS_NOT_MIGRATED = [
  "editor/edges/EdgeSettingsPopover.svelte",
  "editor/io/ExportDialog.svelte",
  "editor/nodes/table/FieldEditorPanel.svelte",
  "plugins/dialog/InstalledTab.svelte",
  "plugins/dialog/MarketplaceTab.svelte",
  "plugins/dialog/PluginSettingsModal.svelte",
  "plugins/dialog/StudioTab.svelte",
].map((file) => `apps/web/src/features/${file}`);

export default tseslint.config(
  {
    // Static design references contain script fragments assembled by the mockup,
    // rather than standalone application modules.
    ignores: ["**/dist/**", "**/node_modules/**", "**/data/**"],
  },
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
    // that untyped boundary into NebulaDB's own typed `Project` shape.
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
  {
    // The server's storage is asynchronous: a data function that used to
    // return a row now returns a promise, and a forgotten `await` is a
    // condition that is always true or a write nobody waits for. Only the
    // type checker can see that, hence type-aware rules for these files.
    files: ["apps/server/src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          // `node:test` returns a promise from `test()` for sub-tests to await;
          // at the top level of a file the runner is what waits for it.
          allowForKnownSafeCalls: [
            { from: "package", package: "node:test", name: ["test", "it", "describe", "suite"] },
          ],
        },
      ],
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
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
      "no-restricted-syntax": ["error", HARD_CODED_TEXT, ...ARBITRARY_FONT_SIZE],
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
        ...ARBITRARY_FONT_SIZE,
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
  // The page table and the text field are components: a screen that draws its own differs from the
  // others by a pixel of padding it will never be asked to explain. One rule, so each file gets the
  // elements it has not been grandfathered for (a later block overrides an earlier one).
  {
    files: ["apps/web/src/features/**/*.svelte"],
    rules: {
      "svelte/no-restricted-html-elements": ["error", RAW_TABLE_RESTRICTION, RAW_INPUT_RESTRICTION],
    },
  },
  {
    files: RAW_TABLE_NOT_MIGRATED,
    rules: { "svelte/no-restricted-html-elements": ["error", RAW_INPUT_RESTRICTION] },
  },
  {
    files: RAW_INPUT_NOT_MIGRATED,
    rules: { "svelte/no-restricted-html-elements": ["error", RAW_TABLE_RESTRICTION] },
  },
  {
    files: RAW_TABLE_NOT_MIGRATED.filter((file) => RAW_INPUT_NOT_MIGRATED.includes(file)),
    rules: { "svelte/no-restricted-html-elements": "off" },
  },
  {
    // Layers: shared building blocks never reach into a feature. `components/`, `services/`, `hooks/`,
    // `utils/` and `i18n/` are below `features/`; the app shell (`app/`) is above it.
    files: ["apps/web/src/{components,services,hooks,utils,i18n,actions,types}/**/*.{ts,svelte}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/*", "@/app/*"],
              message: "Shared code does not import from a feature or the app shell: move the shared part down to components/, services/ or hooks/.",
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
);
