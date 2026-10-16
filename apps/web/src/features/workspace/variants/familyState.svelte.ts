/**
 * Bumped whenever a variant is made, renamed, deleted, reset or detached, so
 * that what shows a project's family (the header's switcher) fetches it again.
 */
export const familyChanges = $state({ version: 0 });

export function familyChanged(): void {
  familyChanges.version += 1;
}
