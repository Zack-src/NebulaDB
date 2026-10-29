/**
 * `Array.prototype.map` / `filter` for a callback that waits on something —
 * typically a row to look up per item. `items.map(async …)` gives back
 * promises, and `filter(async …)` keeps everything (a promise is truthy);
 * neither is caught by the compiler when the result is only serialised.
 *
 * One item at a time, in order: inside a transaction every lookup shares one
 * connection anyway, and outside one this keeps a long list from taking the
 * whole pool for itself.
 */
export async function mapAsync<T, U>(items: readonly T[], fn: (item: T, index: number) => Promise<U>): Promise<U[]> {
  const out: U[] = [];
  for (let index = 0; index < items.length; index++) out.push(await fn(items[index], index));
  return out;
}

export async function filterAsync<T>(items: readonly T[], keep: (item: T) => Promise<boolean>): Promise<T[]> {
  const out: T[] = [];
  for (const item of items) if (await keep(item)) out.push(item);
  return out;
}

/** `Array.prototype.some`: stops at the first item that matches. */
export async function someAsync<T>(items: readonly T[], test: (item: T) => Promise<boolean>): Promise<boolean> {
  for (const item of items) if (await test(item)) return true;
  return false;
}
