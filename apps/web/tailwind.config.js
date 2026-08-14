/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  // Preflight (Tailwind's CSS reset) fights the app's own global reset
  // (index.css, tuned for the canvas/React-Flow internals — it removes
  // button/input UA styles our hand-written classes still rely on in
  // un-migrated components). Tailwind v4 dropped `corePlugins` from
  // `@config`-loaded JS configs, so preflight is skipped at the import
  // site instead (styles/tailwind.css imports theme + utilities only).
  theme: {
    extend: {
      colors: {
        // Bridge to the existing CSS custom properties (index.css :root) so
        // Tailwind utilities (bg-surface, text-muted, border-default, …)
        // resolve to the same design tokens hand-written CSS already uses —
        // one palette, two authoring surfaces, instead of a second one to
        // keep in sync.
        bg: {
          DEFAULT: "var(--color-bg)",
          canvas: "var(--color-bg-canvas)",
        },
        surface: {
          DEFAULT: "var(--color-surface)",
          raised: "var(--color-surface-raised)",
          hover: "var(--color-surface-hover)",
        },
        border: {
          DEFAULT: "var(--color-border)",
          strong: "var(--color-border-strong)",
        },
        text: {
          DEFAULT: "var(--color-text)",
          secondary: "var(--color-text-secondary)",
          muted: "var(--color-text-muted)",
          onaccent: "var(--color-text-on-accent)",
          onlight: "var(--color-text-on-light)",
        },
        primary: {
          DEFAULT: "var(--color-primary)",
          hover: "var(--color-primary-hover)",
          light: "var(--color-primary-light)",
          border: "var(--color-primary-border)",
        },
        danger: {
          DEFAULT: "var(--color-danger)",
          hover: "var(--color-danger-hover)",
          light: "var(--color-danger-light)",
        },
        warning: {
          DEFAULT: "var(--color-warning)",
          light: "var(--color-warning-light)",
        },
        success: {
          DEFAULT: "var(--color-success)",
          light: "var(--color-success-light)",
        },
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius-md)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        full: "var(--radius-full)",
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      fontFamily: {
        sans: "var(--font-sans)",
        mono: "var(--font-mono)",
      },
      keyframes: {
        "overlay-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "modal-in": {
          from: { opacity: "0", transform: "translateY(6px) scale(0.98)" },
          to: { opacity: "1", transform: "none" },
        },
      },
      animation: {
        "overlay-in": "overlay-in 0.12s ease",
        "modal-in": "modal-in 0.14s cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};
