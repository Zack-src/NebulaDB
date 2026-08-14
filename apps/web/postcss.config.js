export default {
  plugins: {
    // Must run first and be declared explicitly: without it Vite resolves the
    // `@import`s itself and hoists every one to the top of the bundle, which
    // would move `styles/utilities.css` *above* Tailwind's utilities and let
    // `bg-surface/90` beat `.glass-panel`'s own background. Inlining the
    // imports in place keeps the authored cascade order.
    "postcss-import": {},
    // Tailwind v4: the PostCSS plugin now lives in its own package, and it
    // handles vendor prefixing itself (via Lightning CSS) — autoprefixer is
    // no longer needed.
    "@tailwindcss/postcss": {},
  },
};
