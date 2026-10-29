# Opening a project: performance log

`measure-open.mjs` times how long a project takes to show its DBML code and its graph (see the header of
the script for the exact definitions and the three conditions). Every optimisation of the opening path is
measured with it before and after; the results are kept in `docs/perf/open-project/<step>.json`.

```
npm run build
PERF_EMAIL=… PERF_PASSWORD=… node scripts/perf/measure-open.mjs --label NN-short-name
```

Medians of 7 runs per condition. Read `p25`/`p75` before trusting a small difference.
