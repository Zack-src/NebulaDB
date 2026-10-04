/**
 * How the open project's socket reaches the bell: the server's
 * `notification` notice lands in the editor, the bell sits several components
 * away in the header, and nothing between them has any use for it. A counter
 * rather than an event: the bell only needs to know "read the inbox again".
 */
let pushes = $state(0);

export const inboxPush = {
  /** Changes each time the server says this account has a new notification. */
  get count(): number {
    return pushes;
  },
  signal(): void {
    pushes += 1;
  },
};
