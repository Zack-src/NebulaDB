# Canvas perf benchmark — `p0-1-lod`

Run: 2026-09-14T23:18:26.329Z · window 1600×900 · zoom 0.6

Per scenario: **blocking** = main-thread time in tasks over 50ms (the freeze proxy), **p95/worst** = frame interval, **drops** = frames over 33ms.

## 200 tables · 8 columns · full

Load+mount: 695ms (200 nodes, 199 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| select-multi | 0 | 0 | 13.9 | 41.7 | 1 | 124.2 |
| drag-multi | 0 | 0 | 13.9 | 48.7 | 1 | 124 |

## 500 tables · 8 columns · standard

Load+mount: 1847ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| select-multi | 136 | 84 | 20.9 | 83.4 | 8 | 94.8 |
| drag-multi | 52 | 102 | 41.7 | 146 | 29 | 75.1 |

## 500 tables · 8 columns · full

Load+mount: 1275ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| select-multi | 107 | 79 | 20.9 | 76.6 | 8 | 98.1 |
| drag-multi | 66 | 116 | 34.8 | 139.1 | 29 | 89.7 |
