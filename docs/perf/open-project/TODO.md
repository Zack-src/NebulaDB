# Opening a project: what is left to do

State on 2026-10-22: steps 00 to 10 are implemented, committed and measured one by one (see the `NN-*.json`
files and `README.md`). Rejected experiments are in `REJECTED.md`.

## 1. Consolidated before/after benchmark (interrupted)

Goal: one accurate table, free of machine drift, for the technical presentation.

- Round 1 of 3 is done: `rr-1-<commit>.json` for ed2f0ac, c203705, 7cf18b8, cdab341, ea3542c, 58f838c, 14d1e1a
  (all 4 conditions, 5 runs each). Rounds 2 and 3 never ran (the script was stopped).
- To finish: rebuild the snapshots if `E:\repos\perso\nebula-snaps\<commit>` is gone (one `npm run build` per
  commit in the worktree `E:\repos\perso\nebula-baseline`, copy `apps/web/dist` to the snapshots folder), then
  for each round and each commit: copy that snapshot to the worktree's `apps/web/dist`, and run
  `PERF_EMAIL=… PERF_PASSWORD=… node scripts/perf/measure-open.mjs --label rr-<round>-<commit> --runs 5 --base http://localhost:3002 --commit <commit>`
  against the worktree's server (checked out at 14d1e1a, port 3002, `.env` copied with `PORT=3002`).
  About 30 to 40 minutes for rounds 2 and 3.
- Then take, per commit and condition, the median of the three rounds' medians.
- Caveat to state in the report: the server is the latest one for every snapshot, so WebSocket deflate (step 9)
  also benefits the older web builds. Step 9 is measured on its own in `09-ws-deflate.json`.
- Round 1 sample (warm 4G, code and graph visible): 861 ms at ed2f0ac, 226 ms at 14d1e1a. One round only,
  not reliable yet.

## 2. Presentation graphs

An artifact with: the step by step progression (baseline to step 10) per condition (fast, CPU x4, cold 4G,
warm 4G); the main before/after for code and graph visible; picture (about 73 ms) versus live editor
(about 190 ms code, 350 ms graph); time until every column is back.

## 3. Documentation

- Update `README.md` here with the consolidated results.
- Correct the earlier analysis artifact (https://claude.ai/artifact/5K6xoQ1HH6qp7iicpeUWWJ): the "forced
  layouts" are the first layout of the new DOM, and about 1,100 handles are needed (about 4 per reference
  column), not 440.

## 4. Optional optimisations (one by one, each measured A/B against the previous commit)

- Handles only for columns that take part in a reference (expected gain on CPU x4).
- Lighter or on-demand rows and icons for full detail.
- Small DBML panel and DBML signature work (about 12 to 24 ms).
- A more readable initial zoom: product decision, ask before implementing.
- IndexedDB cache: probably unnecessary now that the picture exists.

## 5. Final checks

- Run the full e2e suite (last full run: 49/51, the two failures being the known `connection-security`
  CRLF-cert one and the server `connections/crypto.test.js` that needs `DATABASE_URL`).
- Make sure `apps/web/dist` is a normal build (not `BENCH_READABLE=1`).

## 6. Clean up

- Stop the comparison server on port 3002.
- Remove the worktree `E:\repos\perso\nebula-baseline` (`git worktree remove --force`) and the folder
  `E:\repos\perso\nebula-snaps`.
- Delete or commit the `rr-1-*.json` files (decide after step 1).
- Stop the test containers if wanted: `docker compose -f docker-compose.test.yml down`.
