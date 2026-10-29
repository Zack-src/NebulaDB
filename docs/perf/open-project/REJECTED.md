# Experiments that did not pay and were not kept

Each was measured A/B against the commit before it (interleaved runs on the same machine, because the
machine drifts by 10-30% over an hour), and reverted.

| Idea | What was measured | Result |
|---|---|---|
| Lazy-load the views `App.svelte` does not show on a deep link (settings, admin, project list…) | CPU x1 / x4, code visible: 186 -> 197 ms / 1010 -> 1072 ms; requests 86 -> 111 | No gain. The saved parse is eaten by the extra chunks' round trips |
| Defer the editor's non-critical requests by 700 ms (locks, seeds, lint, drift, notifications…) | code / graph at x1: 182 / 349 -> 238 / 395 ms | Worse: the route interception costs more than the requests did |
| A separate lightweight component for lite tables, swapped for the real one | graph drawn at x1: 339 -> 343 ms; columns back at x4: 3979 -> 4427 ms; heap +12 MB | No gain, and slower to restore the columns (a component is created, not updated) |
| `content-visibility: visible` instead of `auto` on tables | bench, 132 tables: fit 440 -> 451 ms | No effect |
| Reading all handles' rectangles at once | 2640 `getBoundingClientRect` on a clean DOM: 3.6 ms | Nothing to win: the cost attributed to `getBoundingClientRect` is the first layout of the new DOM |
