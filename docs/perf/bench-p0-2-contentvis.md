# Canvas perf benchmark — `p0-2-contentvis`

Run: 2026-09-14T23:20:31.014Z · window 1600×900 · zoom 0.6

Per scenario: **blocking** = main-thread time in tasks over 50ms (the freeze proxy), **p95/worst** = frame interval, **drops** = frames over 33ms.

## 200 tables · 8 columns · full

Load+mount: 777ms (200 nodes, 199 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.9 | 41.8 | 3 | 124.4 |
| select-multi | 0 | 0 | 7.1 | 20.9 | 0 | 131.2 |
| drag-multi | 0 | 0 | 13.9 | 34.8 | 1 | 127.7 |

## 500 tables · 8 columns · standard

Load+mount: 1428ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 204 | 80 | 34.9 | 83.5 | 15 | 80.9 |
| select-multi | 61 | 73 | 13.9 | 69.5 | 6 | 106.6 |
| drag-multi | 71 | 121 | 41.7 | 159.9 | 29 | 57.7 |

## 500 tables · 8 columns · full

Load+mount: 1992ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 159 | 83 | 34.8 | 90.3 | 14 | 79.5 |
| select-multi | 92 | 75 | 13.9 | 69.5 | 7 | 104.6 |
| drag-multi | 55 | 105 | 48.6 | 145.9 | 29 | 59.5 |
