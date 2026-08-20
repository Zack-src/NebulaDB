# Canvas perf benchmark — `before-multi`

Run: 2026-08-20T13:58:34.148Z · window 1600×900 · zoom 0.6

Per scenario: **blocking** = main-thread time in tasks over 50ms (the freeze proxy), **p95/worst** = frame interval, **drops** = frames over 33ms.

## 200 tables · 8 columns · full

Load+mount: 4915ms (200 nodes, 199 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| select-multi | 471 | 211 | 26.7 | 213.7 | 5 | 49.6 |
| drag-multi | 366 | 416 | 26.7 | 427.2 | 2 | 57.4 |
| recolor-multi | 285 | 265 | 13.5 | 373.7 | 1 | 41.2 |

## 500 tables · 8 columns · standard

Load+mount: 5587ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| select-multi | 1007 | 311 | 213.6 | 320.4 | 7 | 31.5 |
| drag-multi | 556 | 491 | 66.8 | 534 | 29 | 44.8 |
| recolor-multi | 331 | 294 | 13.4 | 413.8 | 1 | 39.8 |

## 500 tables · 8 columns · full

Load+mount: 40313ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| select-multi | 3022 | 992 | 440.6 | 988 | 25 | 13.5 |
| drag-multi | 2522 | 862 | 160.2 | 1321.7 | 52 | 15.6 |
| recolor-multi | 1155 | 709 | 26.8 | 1241.7 | 2 | 14.3 |
