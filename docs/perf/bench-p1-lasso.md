# Canvas perf benchmark — `p1-lasso`

Run: 2026-09-14T23:37:45.199Z · window 1600×900 · zoom 0.6

Per scenario: **blocking** = main-thread time in tasks over 50ms (the freeze proxy), **p95/worst** = frame interval, **drops** = frames over 33ms.

## 200 tables · 8 columns · full

Load+mount: 703ms (200 nodes, 199 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.9 | 34.8 | 5 | 118.5 |
| select-multi | 0 | 0 | 13.9 | 14 | 0 | 133.9 |
| drag-multi | 0 | 0 | 13.9 | 41.7 | 1 | 131.5 |

## 500 tables · 8 columns · standard

Load+mount: 1362ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 248 | 89 | 62.6 | 90.4 | 16 | 75.1 |
| select-multi | 2 | 52 | 13.9 | 62.6 | 6 | 107.5 |
| drag-multi | 46 | 96 | 27.9 | 97.3 | 12 | 91.2 |

## 500 tables · 8 columns · full

Load+mount: 1379ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 150 | 84 | 34.8 | 83.4 | 17 | 81.4 |
| select-multi | 0 | 0 | 14 | 48.6 | 6 | 113.6 |
| drag-multi | 73 | 123 | 27.9 | 152.9 | 13 | 91.5 |
