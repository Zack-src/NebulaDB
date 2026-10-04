import { Annotation } from "@codemirror/state";

// In a module of their own: the editor's setup, its formatter and the
// locked-table guard all need them, and import each other otherwise.

/**
 * Marks a transaction as "this text came from the project document, not from
 * the user" — see the `updateListener` in `createDbmlExtensions`.
 */
export const documentSync = Annotation.define<boolean>();

/** Marks a rewrite that cannot change what the text means (formatting) — it may cross a locked table's block. */
export const harmlessRewrite = Annotation.define<boolean>();
