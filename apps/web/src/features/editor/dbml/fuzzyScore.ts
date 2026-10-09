/** Subsequence match with a bonus for prefix / word-start hits; null when it doesn't match. */
export function fuzzyScore(query: string, text: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const lower = text.toLowerCase();
  if (lower.startsWith(q)) return 1000 - lower.length;
  let qi = 0;
  let points = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) {
      points += i === 0 || /[^A-Za-z0-9]/.test(lower[i - 1]) ? 8 : 3;
      qi += 1;
    }
  }
  return qi === q.length ? points - lower.length * 0.1 : null;
}
