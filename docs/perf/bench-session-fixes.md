# Canvas perf benchmark — `session-fixes`

Run: 2026-09-14T22:59:51.301Z · window 1600×900 · zoom 0.6

Per scenario: **blocking** = main-thread time in tasks over 50ms (the freeze proxy), **p95/worst** = frame interval, **drops** = frames over 33ms.

## 200 tables · 8 columns · full

Load+mount: 3221ms (200 nodes, 199 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| select-multi | 320 | 135 | 48.6 | 138.9 | 8 | 58.2 |
| drag-multi | 103 | 153 | 48.6 | 208.4 | 43 | 48.8 |

## 500 tables · 8 columns · standard

Load+mount: 3139ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| select-multi | 487 | 161 | 41.6 | 166.8 | 9 | 57.6 |
| drag-multi | 94 | 144 | 55.7 | 194.5 | 46 | 43 |

## 500 tables · 8 columns · full

Load+mount: 17925ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| select-multi | 1587 | 553 | 236.4 | 542.3 | 30 | 17.6 |
| drag-multi | 2310 | 549 | 167 | 639.6 | 70 | 13.8 |
