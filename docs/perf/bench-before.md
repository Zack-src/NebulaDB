# Canvas perf benchmark — `before`

Run: 2026-08-20T13:23:56.025Z · window 1600×900 · zoom 0.6

Per scenario: **blocking** = main-thread time in tasks over 50ms (the freeze proxy), **p95/worst** = frame interval, **drops** = frames over 33ms.

## 10 tables · 8 columns · full

Load+mount: 520ms (10 nodes, 9 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| drag-single | 0 | 0 | 13.4 | 13.6 | 0 | 74.9 |
| select-multi | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| drag-multi | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| recolor-multi | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| recolor-single | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| column-flag | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| highlight-toggle | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| delete-columns | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |

## 10 tables · 8 columns · standard

Load+mount: 456ms (10 nodes, 9 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| drag-single | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| select-multi | 0 | 0 | 13.4 | 13.6 | 0 | 74.9 |
| drag-multi | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| recolor-multi | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| recolor-single | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| column-flag | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| highlight-toggle | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| delete-columns | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |

## 10 tables · 8 columns · compact

Load+mount: 441ms (10 nodes, 9 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| drag-single | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| select-multi | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| drag-multi | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| recolor-multi | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| recolor-single | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| column-flag | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| highlight-toggle | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| delete-columns | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |

## 50 tables · 8 columns · full

Load+mount: 783ms (50 nodes, 49 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| drag-single | 15 | 65 | 13.5 | 53.4 | 1 | 72.9 |
| select-multi | 0 | 0 | 26.6 | 26.7 | 0 | 69.7 |
| drag-multi | 0 | 0 | 13.4 | 66.8 | 1 | 71.5 |
| recolor-multi | 14 | 64 | 13.5 | 80.1 | 1 | 65.1 |
| recolor-single | 15 | 65 | 13.5 | 53.4 | 1 | 68.7 |
| column-flag | 19 | 69 | 13.5 | 66.7 | 1 | 65.3 |
| highlight-toggle | 239 | 172 | 13.5 | 200.3 | 2 | 55.5 |
| delete-columns | 14 | 64 | 13.5 | 66.8 | 1 | 66.8 |

## 50 tables · 8 columns · standard

Load+mount: 539ms (50 nodes, 49 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| drag-single | 0 | 0 | 13.5 | 26.7 | 0 | 74.5 |
| select-multi | 0 | 0 | 13.5 | 13.5 | 0 | 75.1 |
| drag-multi | 0 | 0 | 13.4 | 26.6 | 0 | 74.2 |
| recolor-multi | 0 | 0 | 13.5 | 26.8 | 0 | 72.8 |
| recolor-single | 0 | 0 | 13.4 | 26.6 | 0 | 72.7 |
| column-flag | 0 | 0 | 13.5 | 23.2 | 0 | 73.2 |
| highlight-toggle | 0 | 0 | 13.5 | 53.3 | 2 | 69.7 |
| delete-columns | 0 | 0 | 13.5 | 26.7 | 0 | 72.8 |

## 50 tables · 8 columns · compact

Load+mount: 461ms (50 nodes, 0 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| drag-single | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| select-multi | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| drag-multi | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| recolor-multi | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| recolor-single | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| column-flag | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| highlight-toggle | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| delete-columns | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |

## 100 tables · 8 columns · full

Load+mount: 1559ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.5 | 26.8 | 0 | 72 |
| drag-single | 83 | 133 | 13.4 | 146.8 | 2 | 67.4 |
| select-multi | 48 | 64 | 13.5 | 80.2 | 4 | 61.3 |
| drag-multi | 67 | 83 | 13.4 | 133.5 | 2 | 66.8 |
| recolor-multi | 83 | 127 | 13.4 | 173.6 | 1 | 54.9 |
| recolor-single | 76 | 126 | 13.5 | 133.6 | 1 | 59.2 |
| column-flag | 74 | 124 | 13.5 | 133.5 | 1 | 58.9 |
| highlight-toggle | 1096 | 567 | 13.5 | 640.9 | 2 | 34.7 |
| delete-columns | 78 | 128 | 13.5 | 133.5 | 1 | 58.9 |

## 100 tables · 8 columns · standard

Load+mount: 714ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| drag-single | 8 | 58 | 13.5 | 53.3 | 1 | 73.3 |
| select-multi | 0 | 0 | 13.5 | 26.7 | 0 | 72.7 |
| drag-multi | 0 | 0 | 13.4 | 53.4 | 1 | 72.9 |
| recolor-multi | 9 | 59 | 13.4 | 66.8 | 1 | 66.8 |
| recolor-single | 5 | 55 | 13.5 | 53.6 | 1 | 68.6 |
| column-flag | 7 | 57 | 13.5 | 66.7 | 1 | 66.8 |
| highlight-toggle | 171 | 136 | 13.4 | 160.2 | 2 | 58.2 |
| delete-columns | 5 | 55 | 13.5 | 53.3 | 1 | 68.7 |

## 100 tables · 8 columns · compact

Load+mount: 513ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| drag-single | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| select-multi | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| drag-multi | 0 | 0 | 13.5 | 26.7 | 0 | 74.2 |
| recolor-multi | 0 | 0 | 13.5 | 26.6 | 0 | 72.7 |
| recolor-single | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| column-flag | 0 | 0 | 13.5 | 26.7 | 0 | 72.7 |
| highlight-toggle | 0 | 0 | 13.5 | 53.5 | 2 | 70.5 |
| delete-columns | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |

## 200 tables · 8 columns · full

Load+mount: 4554ms (200 nodes, 199 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 26.6 | 40 | 1 | 69.2 |
| zoom-links-on | 0 | 0 | 26.7 | 40.2 | 2 | 63.8 |
| drag-single | 259 | 302 | 26.7 | 307.1 | 3 | 58.8 |
| select-multi | 380 | 159 | 13.6 | 160.3 | 3 | 53.2 |
| drag-multi | 307 | 175 | 26.7 | 307.1 | 3 | 54.5 |
| recolor-multi | 261 | 242 | 13.4 | 347.1 | 1 | 43.2 |
| recolor-single | 204 | 254 | 13.5 | 280.4 | 1 | 47.2 |
| column-flag | 208 | 258 | 13.4 | 293.7 | 1 | 46.3 |
| highlight-toggle | 4946 | 2403 | 13.5 | 2563.2 | 2 | 13.3 |
| delete-columns | 212 | 262 | 13.5 | 280.3 | 1 | 46.6 |

## 200 tables · 8 columns · standard

Load+mount: 1270ms (200 nodes, 199 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.7 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| drag-single | 66 | 116 | 13.5 | 133.5 | 2 | 67.7 |
| select-multi | 12 | 56 | 13.6 | 66.9 | 4 | 62.3 |
| drag-multi | 38 | 78 | 13.5 | 120.2 | 2 | 67.9 |
| recolor-multi | 65 | 115 | 13.4 | 133.4 | 1 | 58.9 |
| recolor-single | 67 | 117 | 13.5 | 130 | 1 | 59.2 |
| column-flag | 65 | 115 | 13.5 | 146.8 | 1 | 57.5 |
| highlight-toggle | 879 | 460 | 13.5 | 520.6 | 2 | 38.9 |
| delete-columns | 60 | 110 | 13.4 | 120.2 | 1 | 60.3 |

## 200 tables · 8 columns · compact

Load+mount: 660ms (200 nodes, 199 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.7 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| drag-single | 0 | 0 | 13.5 | 53.3 | 1 | 73.1 |
| select-multi | 0 | 0 | 13.5 | 26.8 | 0 | 73.2 |
| drag-multi | 0 | 0 | 13.5 | 53.3 | 1 | 72.9 |
| recolor-multi | 0 | 0 | 13.4 | 53.5 | 1 | 68.9 |
| recolor-single | 0 | 0 | 13.5 | 53.5 | 1 | 68.7 |
| column-flag | 0 | 0 | 13.5 | 66.9 | 1 | 67 |
| highlight-toggle | 153 | 133 | 13.5 | 160.3 | 2 | 60.2 |
| delete-columns | 0 | 0 | 13.5 | 53.4 | 1 | 68.7 |

## 500 tables · 8 columns · full

Load+mount: 38913ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 69 | 90 | 40.2 | 66.8 | 20 | 51 |
| zoom-links-on | 383 | 83 | 66.8 | 93.4 | 36 | 34 |
| drag-single | 2082 | 737 | 106.7 | 987.9 | 34 | 29.9 |
| select-multi | 2905 | 834 | 66.8 | 867.7 | 13 | 21.1 |
| drag-multi | 2627 | 621 | 93.7 | 921.2 | 38 | 30.5 |
| recolor-multi | 1076 | 669 | 40 | 1148.2 | 3 | 18.6 |
| recolor-single | 734 | 686 | 40.1 | 801 | 3 | 23.7 |
| column-flag | 769 | 681 | 40.1 | 840.9 | 3 | 23.5 |
| highlight-toggle | 53129 | 26643 | 53.4 | 27060.4 | 7 | 1.5 |
| delete-columns | 732 | 707 | 13.4 | 801.1 | 2 | 26.8 |

## 500 tables · 8 columns · standard

Load+mount: 5094ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 26.7 | 26.8 | 0 | 66.6 |
| zoom-links-on | 2 | 52 | 40 | 40.1 | 16 | 57.6 |
| drag-single | 540 | 396 | 66.7 | 427.2 | 31 | 38.5 |
| select-multi | 851 | 240 | 40 | 320.4 | 5 | 31.9 |
| drag-multi | 653 | 369 | 53.5 | 413.9 | 31 | 35.7 |
| recolor-multi | 307 | 295 | 13.5 | 297.2 | 2 | 44.5 |
| recolor-single | 252 | 282 | 13.5 | 347.1 | 2 | 40 |
| column-flag | 304 | 299 | 13.5 | 387.1 | 2 | 38.1 |
| highlight-toggle | 6946 | 3413 | 40 | 3617.9 | 5 | 9.7 |
| delete-columns | 244 | 278 | 13.4 | 333.9 | 1 | 43.9 |

## 500 tables · 8 columns · compact

Load+mount: 1611ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 26.8 | 0 | 73.2 |
| zoom-links-on | 7 | 57 | 26.7 | 53.4 | 1 | 67.2 |
| drag-single | 179 | 191 | 40.1 | 226.9 | 28 | 47.1 |
| select-multi | 254 | 146 | 13.5 | 106.9 | 3 | 60.6 |
| drag-multi | 192 | 191 | 40.2 | 227 | 30 | 45.4 |
| recolor-multi | 87 | 124 | 13.5 | 133.4 | 1 | 57.9 |
| recolor-single | 65 | 112 | 13.5 | 146.9 | 1 | 56.2 |
| column-flag | 108 | 118 | 13.4 | 186.9 | 1 | 52.6 |
| highlight-toggle | 1593 | 820 | 13.5 | 934.5 | 2 | 28.2 |
| delete-columns | 69 | 115 | 13.5 | 160.2 | 1 | 56.2 |

## 100 tables · 4 columns · standard

Load+mount: 717ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| drag-single | 9 | 59 | 13.5 | 66.7 | 1 | 72 |
| select-multi | 0 | 0 | 13.5 | 26.8 | 0 | 71.4 |
| drag-multi | 0 | 0 | 13.4 | 53.3 | 1 | 72.9 |
| recolor-multi | 6 | 56 | 13.5 | 53.4 | 1 | 68.7 |
| recolor-single | 5 | 55 | 13.4 | 53.5 | 1 | 68.6 |
| column-flag | 7 | 57 | 13.4 | 53.4 | 1 | 68.8 |
| highlight-toggle | 173 | 137 | 13.5 | 160.3 | 2 | 58.3 |
| delete-columns | 3 | 53 | 13.4 | 53.3 | 1 | 68.7 |

## 100 tables · 16 columns · standard

Load+mount: 712ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| drag-single | 9 | 59 | 13.4 | 53.4 | 1 | 72.9 |
| select-multi | 0 | 0 | 13.5 | 26.7 | 0 | 71.7 |
| drag-multi | 0 | 0 | 13.5 | 53.4 | 1 | 72.2 |
| recolor-multi | 6 | 56 | 13.5 | 66.8 | 1 | 66.8 |
| recolor-single | 5 | 55 | 13.5 | 53.4 | 1 | 68.7 |
| column-flag | 6 | 56 | 13.5 | 66.7 | 1 | 66.8 |
| highlight-toggle | 162 | 132 | 13.5 | 160.3 | 2 | 58.9 |
| delete-columns | 5 | 55 | 13.5 | 53.5 | 1 | 68.6 |

## 100 tables · 32 columns · standard

Load+mount: 723ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| drag-single | 14 | 64 | 13.5 | 66.7 | 1 | 72.2 |
| select-multi | 0 | 0 | 13.5 | 26.8 | 0 | 72.7 |
| drag-multi | 0 | 0 | 13.5 | 53.3 | 1 | 72.9 |
| recolor-multi | 8 | 58 | 13.4 | 53.5 | 1 | 68.8 |
| recolor-single | 5 | 55 | 13.5 | 53.4 | 1 | 68.7 |
| column-flag | 6 | 56 | 13.5 | 80.1 | 1 | 65.1 |
| highlight-toggle | 238 | 194 | 13.5 | 240.3 | 2 | 55.7 |
| delete-columns | 9 | 59 | 13.5 | 53.5 | 1 | 69 |
