/**
 * Which project, and which account, the comments being written belong to.
 *
 * Comment composers sit deep inside canvas nodes (and a node's data is built
 * far from the editor); the two facts they need — the project to ask who can
 * be mentioned, the account to stamp on the comment — are fixed for as long as
 * the editor is open, so the editor states them once here rather than through
 * five layers of props.
 */
export interface CommentsSession {
  projectId: string;
  userId: string;
}

let current: CommentsSession | null = null;

export const commentsSession = {
  set(next: CommentsSession | null): void {
    current = next;
  },
  get(): CommentsSession | null {
    return current;
  },
};
