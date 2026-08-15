// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
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
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // Guard against the UI drifting back to hard-coded copy. Every user-facing
    // string goes through `t()` and lives in src/locales; a bare sentence in
    // JSX is one that can never be translated. Four-letter minimum so
    // separators, punctuation and short code identifiers don't trip it.
    files: ["apps/web/src/**/*.tsx"],
    ignores: ["apps/web/src/locales/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXText[value=/[A-Za-zÀ-ÿ]{4,}/]",
          message: "Hard-coded UI text. Add the string to src/locales/fr.json + en.json and render it with t('key').",
        },
      ],
    },
  },
  eslintConfigPrettier,
);
