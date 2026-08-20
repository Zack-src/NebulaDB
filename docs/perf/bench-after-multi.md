# Canvas perf benchmark — `after-multi`

Run: 2026-08-20T13:56:52.841Z · window 1600×900 · zoom 0.6

Per scenario: **blocking** = main-thread time in tasks over 50ms (the freeze proxy), **p95/worst** = frame interval, **drops** = frames over 33ms.

## 200 tables · 8 columns · full

Load+mount: 2756ms (200 nodes, 199 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| select-multi | 79 | 87 | 26.8 | 93.5 | 5 | 58.6 |
| drag-multi | 33 | 83 | 13.5 | 93.4 | 1 | 69.8 |
| recolor-multi | 15 | 65 | 13.5 | 66.8 | 1 | 66.8 |

## 500 tables · 8 columns · standard

Load+mount: 2813ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| select-multi | 269 | 115 | 26.7 | 120.2 | 5 | 54.5 |
| drag-multi | 28 | 78 | 26.7 | 93.4 | 1 | 64 |
| recolor-multi | 1 | 51 | 13.5 | 53.4 | 1 | 68.7 |

## 500 tables · 8 columns · full

Load+mount: 13527ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| select-multi | 802 | 299 | 160 | 307.1 | 17 | 27 |
| drag-multi | 698 | 288 | 106.8 | 320.5 | 52 | 24.2 |
| recolor-multi | 187 | 235 | 26.7 | 267 | 2 | 36.3 |
