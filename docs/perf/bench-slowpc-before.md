# Canvas perf benchmark — `slowpc-before`

Run: 2026-10-06T12:14:36.091Z · window 1600×900 · zoom 0.6 · CPU ×6

Per scenario: **blocking** = main-thread time in tasks over 50ms (the freeze proxy), **p95/worst** = frame interval, **drops** = frames over 33ms, **script/style/layout/other** = main-thread ms by kind of work (other = paint, hit testing, GC).

## 50 tables · 8 columns · full

Load+mount: 3244ms (50 nodes, 49 edges in DOM)

| scenario | blocking ms | long tasks | longtask max | frame p95 | worst frame | drops | fps | script | style | layout | other |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 1542 | 34 | 149 | 133.5 | 160.2 | 40 | 21.7 | 431 | 214 | 131 | 3089 |
| pan | 293 | 21 | 81 | 66.8 | 93.5 | 37 | 34.2 | 347 | 207 | 44 | 1972 |
| hover-sweep | 171 | 8 | 85 | 26.7 | 93.5 | 10 | 61.4 | 341 | 179 | 18 | 1220 |
| zoom-links-on | 1597 | 35 | 227 | 146.7 | 240.2 | 52 | 20.9 | 353 | 346 | 75 | 4311 |
| idle-links-on | 0 | 0 | 0 | 26.8 | 40.1 | 2 | 61.8 | 9 | 205 | 0 | 1762 |
| drag-single | 109 | 5 | 89 | 26.8 | 80.2 | 9 | 56.7 | 536 | 141 | 53 | 2130 |
| select-multi | 176 | 7 | 104 | 53.5 | 106.7 | 11 | 50.5 | 257 | 233 | 31 | 1225 |
| drag-multi | 16 | 2 | 65 | 40.1 | 66.7 | 22 | 57.6 | 643 | 196 | 48 | 2196 |
| recolor-multi | 5 | 1 | 55 | 13.5 | 80 | 1 | 63.7 | 42 | 19 | 1 | 468 |
| recolor-single | 0 | 0 | 0 | 13.5 | 53.4 | 1 | 69 | 35 | 16 | 1 | 366 |
| column-flag | 40 | 1 | 90 | 13.4 | 20.1 | 0 | 73.8 | 100 | 20 | 3 | 404 |
| highlight-toggle | 59 | 2 | 102 | 26.7 | 133.5 | 2 | 62.2 | 77 | 152 | 11 | 1052 |
| delete-columns | 44 | 2 | 87 | 13.5 | 146.8 | 1 | 58.3 | 108 | 18 | 6 | 393 |

## 100 tables · 8 columns · standard

Load+mount: 2655ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | long tasks | longtask max | frame p95 | worst frame | drops | fps | script | style | layout | other |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 921 | 25 | 142 | 106.7 | 146.8 | 35 | 27.6 | 563 | 275 | 178 | 1997 |
| pan | 7 | 2 | 54 | 40 | 53.5 | 13 | 58.6 | 235 | 126 | 33 | 967 |
| hover-sweep | 0 | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 | 71 | 0 | 0 | 306 |
| zoom-links-on | 1138 | 34 | 134 | 106.8 | 146.8 | 41 | 22.6 | 624 | 535 | 104 | 3047 |
| idle-links-on | 0 | 0 | 0 | 13.5 | 26.7 | 0 | 73.9 | 10 | 313 | 0 | 1533 |
| drag-single | 55 | 2 | 90 | 26.7 | 80.1 | 2 | 66.3 | 155 | 70 | 12 | 1021 |
| select-multi | 172 | 5 | 109 | 40 | 120.1 | 6 | 53.5 | 273 | 160 | 45 | 1051 |
| drag-multi | 19 | 2 | 65 | 13.4 | 106.8 | 1 | 70.5 | 118 | 129 | 9 | 1191 |
| recolor-multi | 59 | 1 | 109 | 13.5 | 120 | 1 | 61.3 | 87 | 1 | 0 | 62 |
| recolor-single | 12 | 1 | 62 | 13.5 | 66.6 | 1 | 67.2 | 48 | 1 | 1 | 50 |
| column-flag | 112 | 2 | 143 | 13.4 | 200.3 | 1 | 53.9 | 188 | 5 | 11 | 158 |
| highlight-toggle | 141 | 3 | 155 | 13.4 | 213.6 | 2 | 58.2 | 194 | 185 | 20 | 670 |
| delete-columns | 64 | 1 | 114 | 13.4 | 120.1 | 1 | 61 | 112 | 3 | 4 | 70 |

## 100 tables · 8 columns · full

Load+mount: 3993ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | long tasks | longtask max | frame p95 | worst frame | drops | fps | script | style | layout | other |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 3450 | 37 | 315 | 226.9 | 307.2 | 41 | 14 | 805 | 481 | 271 | 4212 |
| pan | 607 | 21 | 121 | 93.4 | 133.5 | 39 | 31.1 | 611 | 219 | 54 | 2056 |
| hover-sweep | 382 | 10 | 98 | 40.1 | 106.9 | 21 | 57.2 | 460 | 160 | 16 | 1241 |
| zoom-links-on | 3372 | 44 | 246 | 200.3 | 267.1 | 56 | 13.7 | 467 | 599 | 119 | 5895 |
| idle-links-on | 0 | 0 | 0 | 26.7 | 26.8 | 0 | 62.2 | 9 | 285 | 0 | 1712 |
| drag-single | 128 | 3 | 154 | 40.1 | 160.2 | 29 | 52.2 | 824 | 105 | 66 | 2132 |
| select-multi | 417 | 10 | 129 | 106.7 | 133.5 | 12 | 40.1 | 496 | 226 | 36 | 1250 |
| drag-multi | 245 | 25 | 110 | 66.7 | 120.2 | 32 | 41.1 | 1011 | 205 | 71 | 2430 |
| recolor-multi | 28 | 1 | 78 | 13.4 | 106.8 | 1 | 62.7 | 63 | 20 | 1 | 444 |
| recolor-single | 27 | 1 | 77 | 13.5 | 93.5 | 1 | 64.2 | 63 | 20 | 1 | 452 |
| column-flag | 81 | 1 | 131 | 26.7 | 160.3 | 1 | 52.6 | 134 | 20 | 3 | 510 |
| highlight-toggle | 225 | 2 | 217 | 26.8 | 240.3 | 5 | 47.7 | 197 | 225 | 16 | 1316 |
| delete-columns | 128 | 2 | 139 | 13.4 | 240.2 | 1 | 50.4 | 179 | 23 | 7 | 486 |

## 200 tables · 8 columns · standard

Load+mount: 2769ms (200 nodes, 199 edges in DOM)

| scenario | blocking ms | long tasks | longtask max | frame p95 | worst frame | drops | fps | script | style | layout | other |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 908 | 26 | 176 | 106.7 | 187 | 35 | 27.9 | 914 | 337 | 279 | 1443 |
| pan | 0 | 0 | 0 | 13.5 | 28 | 0 | 72.4 | 139 | 29 | 28 | 551 |
| hover-sweep | 0 | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 | 66 | 0 | 0 | 363 |
| zoom-links-on | 1411 | 28 | 186 | 133.6 | 186.9 | 43 | 19.2 | 843 | 928 | 144 | 2315 |
| idle-links-on | 0 | 0 | 0 | 26.7 | 26.9 | 0 | 55.3 | 7 | 494 | 0 | 1533 |
| drag-single | 0 | 0 | 0 | 13.4 | 26.8 | 0 | 74.3 | 45 | 30 | 7 | 358 |
| select-multi | 0 | 0 | 0 | 26.5 | 40 | 2 | 69.1 | 97 | 84 | 28 | 793 |
| drag-multi | 0 | 0 | 0 | 13.4 | 40.1 | 1 | 73.8 | 57 | 82 | 3 | 1039 |
| recolor-multi | 101 | 1 | 151 | 13.5 | 160.3 | 1 | 57 | 125 | 2 | 1 | 68 |
| recolor-single | 36 | 1 | 86 | 13.4 | 93.4 | 1 | 63.9 | 74 | 1 | 1 | 52 |
| column-flag | 131 | 1 | 181 | 13.4 | 187 | 1 | 54.6 | 196 | 1 | 2 | 101 |
| highlight-toggle | 283 | 2 | 287 | 26.8 | 293.7 | 3 | 46.9 | 258 | 257 | 18 | 651 |
| delete-columns | 130 | 1 | 180 | 13.4 | 200.3 | 1 | 53.9 | 184 | 3 | 5 | 84 |
