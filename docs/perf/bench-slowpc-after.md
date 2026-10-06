# Canvas perf benchmark — `slowpc-after`

Run: 2026-10-06T12:33:34.711Z · window 1600×900 · zoom 0.6 · CPU ×6

Per scenario: **blocking** = main-thread time in tasks over 50ms (the freeze proxy), **p95/worst** = frame interval, **drops** = frames over 33ms, **script/style/layout/other** = main-thread ms by kind of work (other = paint, hit testing, GC).

## 50 tables · 8 columns · full

Load+mount: 3671ms (50 nodes, 49 edges in DOM)

| scenario | blocking ms | long tasks | longtask max | frame p95 | worst frame | drops | fps | script | style | layout | other |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 277 | 15 | 89 | 66.9 | 93.4 | 26 | 38.6 | 405 | 158 | 116 | 1389 |
| zoom-again | 85 | 8 | 68 | 53.4 | 80.1 | 17 | 45.5 | 165 | 76 | 63 | 1364 |
| pan | 0 | 0 | 0 | 26.7 | 40.1 | 3 | 63 | 136 | 113 | 34 | 941 |
| hover-sweep | 25 | 3 | 65 | 13.5 | 53.4 | 6 | 70.4 | 359 | 100 | 35 | 589 |
| zoom-links-on | 248 | 20 | 92 | 66.8 | 106.9 | 29 | 37.6 | 299 | 206 | 78 | 1614 |
| idle-links-on | 0 | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 | 8 | 0 | 0 | 100 |
| drag-single | 50 | 1 | 100 | 26.7 | 106.8 | 2 | 66.8 | 480 | 116 | 52 | 1504 |
| select-multi | 182 | 7 | 137 | 53.4 | 133.5 | 9 | 51.3 | 322 | 222 | 44 | 928 |
| drag-multi | 25 | 2 | 68 | 26.7 | 66.7 | 5 | 61 | 637 | 201 | 52 | 1517 |
| recolor-multi | 1 | 1 | 51 | 13.5 | 66.8 | 1 | 67.2 | 37 | 17 | 1 | 302 |
| recolor-single | 4 | 1 | 54 | 13.5 | 53.5 | 1 | 69 | 42 | 20 | 1 | 273 |
| column-flag | 47 | 1 | 97 | 13.4 | 106.9 | 1 | 62.7 | 109 | 25 | 3 | 306 |
| highlight-toggle | 66 | 2 | 110 | 13.4 | 120.2 | 2 | 65.9 | 95 | 118 | 12 | 749 |
| delete-columns | 69 | 2 | 104 | 26.7 | 160.2 | 1 | 53.1 | 137 | 31 | 6 | 365 |

## 100 tables · 8 columns · standard

Load+mount: 2694ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | long tasks | longtask max | frame p95 | worst frame | drops | fps | script | style | layout | other |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 456 | 17 | 148 | 80.2 | 146.8 | 25 | 36.6 | 588 | 222 | 183 | 1298 |
| zoom-again | 58 | 7 | 78 | 53.3 | 80.1 | 16 | 48.1 | 220 | 118 | 70 | 1196 |
| pan | 0 | 0 | 0 | 13.4 | 26.7 | 0 | 74.4 | 84 | 73 | 25 | 664 |
| hover-sweep | 0 | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 | 90 | 0 | 0 | 366 |
| zoom-links-on | 452 | 25 | 98 | 80.1 | 106.8 | 34 | 32.9 | 582 | 311 | 105 | 1646 |
| idle-links-on | 0 | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 | 8 | 0 | 0 | 140 |
| drag-single | 12 | 2 | 58 | 13.5 | 53.5 | 2 | 68.8 | 111 | 38 | 8 | 467 |
| select-multi | 79 | 5 | 75 | 40.1 | 80.2 | 6 | 58.9 | 228 | 131 | 33 | 861 |
| drag-multi | 8 | 1 | 58 | 13.4 | 93.4 | 1 | 71.7 | 105 | 101 | 10 | 930 |
| recolor-multi | 81 | 1 | 131 | 13.5 | 133.4 | 1 | 59.6 | 106 | 1 | 1 | 73 |
| recolor-single | 20 | 1 | 70 | 13.4 | 66.7 | 1 | 67.2 | 53 | 1 | 1 | 59 |
| column-flag | 107 | 2 | 147 | 13.4 | 186.9 | 1 | 54.6 | 189 | 4 | 8 | 69 |
| highlight-toggle | 139 | 4 | 142 | 13.4 | 186.9 | 2 | 60.1 | 201 | 85 | 23 | 306 |
| delete-columns | 93 | 1 | 143 | 13.4 | 146.9 | 1 | 58.3 | 137 | 3 | 4 | 79 |

## 100 tables · 8 columns · full

Load+mount: 3706ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | long tasks | longtask max | frame p95 | worst frame | drops | fps | script | style | layout | other |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 1328 | 29 | 217 | 133.5 | 213.6 | 36 | 23.9 | 765 | 346 | 251 | 2107 |
| zoom-again | 495 | 21 | 104 | 93.4 | 106.8 | 32 | 32.5 | 222 | 126 | 89 | 2018 |
| pan | 0 | 0 | 0 | 26.7 | 40.1 | 4 | 62.9 | 112 | 94 | 35 | 979 |
| hover-sweep | 95 | 9 | 70 | 13.5 | 80 | 10 | 68 | 455 | 88 | 22 | 650 |
| zoom-links-on | 1054 | 30 | 116 | 106.8 | 120.3 | 38 | 24.8 | 453 | 371 | 119 | 2439 |
| idle-links-on | 0 | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 | 8 | 0 | 0 | 118 |
| drag-single | 123 | 3 | 159 | 40 | 160.2 | 14 | 56.4 | 808 | 126 | 70 | 1746 |
| select-multi | 245 | 6 | 115 | 53.3 | 120.3 | 9 | 51.6 | 415 | 190 | 44 | 886 |
| drag-multi | 57 | 6 | 94 | 40.1 | 93.5 | 29 | 55.4 | 915 | 211 | 70 | 1805 |
| recolor-multi | 29 | 1 | 79 | 13.4 | 93.5 | 1 | 63.9 | 62 | 25 | 1 | 365 |
| recolor-single | 17 | 1 | 67 | 13.4 | 146.8 | 2 | 46.8 | 53 | 22 | 1 | 459 |
| column-flag | 105 | 1 | 155 | 13.5 | 173.5 | 1 | 55.8 | 161 | 23 | 3 | 328 |
| highlight-toggle | 167 | 2 | 181 | 13.5 | 200.2 | 3 | 59.1 | 169 | 154 | 16 | 952 |
| delete-columns | 153 | 2 | 177 | 13.4 | 240.3 | 1 | 50.4 | 210 | 25 | 7 | 332 |

## 200 tables · 8 columns · standard

Load+mount: 3043ms (200 nodes, 199 edges in DOM)

| scenario | blocking ms | long tasks | longtask max | frame p95 | worst frame | drops | fps | script | style | layout | other |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 657 | 20 | 152 | 93.4 | 160.2 | 32 | 32.7 | 901 | 296 | 296 | 1140 |
| zoom-again | 93 | 12 | 72 | 53.4 | 66.8 | 26 | 44.2 | 363 | 219 | 141 | 1077 |
| pan | 0 | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 | 58 | 28 | 18 | 567 |
| hover-sweep | 0 | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 | 85 | 0 | 0 | 523 |
| zoom-links-on | 958 | 16 | 146 | 120.2 | 146.9 | 25 | 28.6 | 864 | 448 | 152 | 1351 |
| idle-links-on | 0 | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 | 10 | 0 | 0 | 127 |
| drag-single | 0 | 0 | 0 | 13.4 | 40 | 1 | 71.7 | 46 | 20 | 6 | 358 |
| select-multi | 0 | 0 | 0 | 13.5 | 40.1 | 3 | 69 | 99 | 93 | 25 | 778 |
| drag-multi | 0 | 0 | 0 | 13.4 | 39.9 | 1 | 73.9 | 53 | 97 | 2 | 1166 |
| recolor-multi | 118 | 1 | 168 | 13.4 | 160.2 | 1 | 57 | 143 | 2 | 0 | 75 |
| recolor-single | 39 | 1 | 89 | 13.5 | 93.5 | 1 | 64.2 | 77 | 1 | 0 | 138 |
| column-flag | 138 | 1 | 188 | 13.4 | 200.3 | 1 | 53.9 | 202 | 1 | 2 | 78 |
| highlight-toggle | 273 | 2 | 265 | 13.4 | 267 | 2 | 57.4 | 286 | 71 | 17 | 269 |
| delete-columns | 127 | 1 | 177 | 13.4 | 187 | 1 | 54.6 | 175 | 4 | 4 | 78 |
