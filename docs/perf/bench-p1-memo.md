# Canvas perf benchmark — `p1-memo`

Run: 2026-09-14T23:51:19.362Z · window 1600×900 · zoom 0.6

Per scenario: **blocking** = main-thread time in tasks over 50ms (the freeze proxy), **p95/worst** = frame interval, **drops** = frames over 33ms.

## 200 tables · 8 columns · full

Load+mount: 724ms (200 nodes, 199 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 7.1 | 34.9 | 1 | 133.6 |
| select-multi | 0 | 0 | 7 | 13.8 | 0 | 142.7 |
| drag-multi | 0 | 0 | 7 | 20.8 | 0 | 142.4 |
| recolor-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| column-flag | 0 | 0 | 7 | 27.8 | 0 | 137.1 |
| highlight-toggle | 0 | 0 | 7 | 34.8 | 1 | 138.1 |
| delete-columns | 0 | 0 | 7.1 | 27.9 | 0 | 137 |

## 500 tables · 8 columns · standard

Load+mount: 1392ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 1 | 51 | 21 | 55.8 | 10 | 99.7 |
| select-multi | 0 | 0 | 13.9 | 27.9 | 0 | 127.5 |
| drag-multi | 12 | 62 | 20.9 | 62.6 | 1 | 110 |
| recolor-multi | 0 | 0 | 7.1 | 41.6 | 1 | 131.1 |
| column-flag | 12 | 62 | 7 | 69.6 | 1 | 125.4 |
| highlight-toggle | 49 | 99 | 7.2 | 104.3 | 2 | 121.4 |
| delete-columns | 15 | 65 | 7.1 | 76.5 | 1 | 123.9 |

## 500 tables · 8 columns · full

Load+mount: 1359ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 20.9 | 48.7 | 10 | 102.7 |
| select-multi | 0 | 0 | 13.8 | 27.9 | 0 | 127.9 |
| drag-multi | 15 | 65 | 20.9 | 69.5 | 1 | 109.4 |
| recolor-multi | 0 | 0 | 7.1 | 41.7 | 1 | 133 |
| column-flag | 13 | 63 | 7.1 | 69.5 | 1 | 125.4 |
| highlight-toggle | 49 | 99 | 7.1 | 104.3 | 2 | 125.6 |
| delete-columns | 15 | 65 | 7.1 | 69.6 | 1 | 125.6 |
