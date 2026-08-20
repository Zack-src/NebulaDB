# Canvas perf benchmark — `after`

Run: 2026-08-20T13:51:57.257Z · window 1600×900 · zoom 0.6

Per scenario: **blocking** = main-thread time in tasks over 50ms (the freeze proxy), **p95/worst** = frame interval, **drops** = frames over 33ms.

## 10 tables · 8 columns · full

Load+mount: 486ms (10 nodes, 9 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| drag-single | 0 | 0 | 13.4 | 13.5 | 0 | 75.3 |
| select-multi | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| drag-multi | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| recolor-multi | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| recolor-single | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| column-flag | 0 | 0 | 13.4 | 13.6 | 0 | 74.9 |
| highlight-toggle | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| delete-columns | 0 | 0 | 13.4 | 13.4 | 0 | 74.9 |

## 10 tables · 8 columns · standard

Load+mount: 450ms (10 nodes, 9 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| drag-single | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| select-multi | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| drag-multi | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| recolor-multi | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| recolor-single | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| column-flag | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| highlight-toggle | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| delete-columns | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |

## 10 tables · 8 columns · compact

Load+mount: 442ms (10 nodes, 9 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.7 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| drag-single | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| select-multi | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| drag-multi | 0 | 0 | 13.4 | 13.9 | 0 | 74.9 |
| recolor-multi | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| recolor-single | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| column-flag | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| highlight-toggle | 0 | 0 | 13.4 | 13.6 | 0 | 74.9 |
| delete-columns | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |

## 50 tables · 8 columns · full

Load+mount: 679ms (50 nodes, 49 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.4 | 13.6 | 0 | 74.9 |
| drag-single | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| select-multi | 0 | 0 | 13.5 | 26.7 | 0 | 73.4 |
| drag-multi | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| recolor-multi | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| recolor-single | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| column-flag | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| highlight-toggle | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| delete-columns | 0 | 0 | 13.4 | 13.6 | 0 | 74.9 |

## 50 tables · 8 columns · standard

Load+mount: 529ms (50 nodes, 49 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| drag-single | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| select-multi | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| drag-multi | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| recolor-multi | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| recolor-single | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| column-flag | 0 | 0 | 13.4 | 13.7 | 0 | 74.9 |
| highlight-toggle | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| delete-columns | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |

## 50 tables · 8 columns · compact

Load+mount: 468ms (50 nodes, 49 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| drag-single | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| select-multi | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| drag-multi | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| recolor-multi | 0 | 0 | 13.4 | 13.4 | 0 | 74.9 |
| recolor-single | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| column-flag | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| highlight-toggle | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| delete-columns | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |

## 100 tables · 8 columns · full

Load+mount: 1143ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.6 | 26.8 | 0 | 71.2 |
| drag-single | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| select-multi | 0 | 0 | 13.5 | 40.1 | 3 | 69.2 |
| drag-multi | 0 | 0 | 13.4 | 39.9 | 1 | 73.5 |
| recolor-multi | 0 | 0 | 13.5 | 26.8 | 0 | 70.6 |
| recolor-single | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| column-flag | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| highlight-toggle | 0 | 0 | 13.5 | 26.6 | 0 | 73.1 |
| delete-columns | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |

## 100 tables · 8 columns · standard

Load+mount: 640ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| drag-single | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| select-multi | 0 | 0 | 13.4 | 13.5 | 0 | 75.1 |
| drag-multi | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| recolor-multi | 0 | 0 | 13.4 | 13.4 | 0 | 75.5 |
| recolor-single | 0 | 0 | 13.4 | 13.6 | 0 | 74.9 |
| column-flag | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| highlight-toggle | 0 | 0 | 13.5 | 27 | 0 | 73.1 |
| delete-columns | 0 | 0 | 13.4 | 13.4 | 0 | 74.9 |

## 100 tables · 8 columns · compact

Load+mount: 503ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| drag-single | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| select-multi | 0 | 0 | 13.5 | 13.5 | 0 | 75.1 |
| drag-multi | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| recolor-multi | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| recolor-single | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| column-flag | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| highlight-toggle | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| delete-columns | 0 | 0 | 13.4 | 13.4 | 0 | 74.9 |

## 200 tables · 8 columns · full

Load+mount: 2804ms (200 nodes, 199 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 39.9 | 1 | 71.4 |
| zoom-links-on | 0 | 0 | 26.7 | 40.1 | 3 | 64.3 |
| drag-single | 0 | 0 | 13.4 | 40.1 | 1 | 72.7 |
| select-multi | 373 | 202 | 13.5 | 227 | 4 | 49 |
| drag-multi | 0 | 0 | 13.4 | 53.5 | 2 | 71.1 |
| recolor-multi | 19 | 69 | 13.5 | 66.9 | 1 | 66.8 |
| recolor-single | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| column-flag | 0 | 0 | 13.5 | 40 | 1 | 70.6 |
| highlight-toggle | 28 | 70 | 13.4 | 80 | 2 | 67 |
| delete-columns | 0 | 0 | 13.5 | 40.1 | 1 | 70.6 |

## 200 tables · 8 columns · standard

Load+mount: 974ms (200 nodes, 199 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.4 | 28.4 | 0 | 74.4 |
| zoom-links-on | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| drag-single | 0 | 0 | 13.5 | 26.7 | 0 | 74.2 |
| select-multi | 0 | 0 | 13.5 | 40.1 | 3 | 69 |
| drag-multi | 0 | 0 | 13.4 | 26.7 | 0 | 74.2 |
| recolor-multi | 0 | 0 | 13.4 | 13.4 | 0 | 74.9 |
| recolor-single | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| column-flag | 0 | 0 | 13.5 | 26.7 | 0 | 72.7 |
| highlight-toggle | 0 | 50 | 13.5 | 80.1 | 2 | 68.2 |
| delete-columns | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |

## 200 tables · 8 columns · compact

Load+mount: 599ms (200 nodes, 199 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| drag-single | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| select-multi | 0 | 0 | 13.4 | 13.5 | 0 | 76.2 |
| drag-multi | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| recolor-multi | 0 | 0 | 13.4 | 13.4 | 0 | 74.9 |
| recolor-single | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| column-flag | 0 | 0 | 13.5 | 26.7 | 0 | 72.7 |
| highlight-toggle | 0 | 0 | 13.4 | 26.7 | 0 | 74 |
| delete-columns | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |

## 500 tables · 8 columns · full

Load+mount: 13314ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 42 | 73 | 26.8 | 80 | 5 | 57.9 |
| zoom-links-on | 136 | 77 | 53.5 | 80.1 | 35 | 38.5 |
| drag-single | 164 | 137 | 40.1 | 160.2 | 31 | 51 |
| select-multi | 841 | 284 | 40.1 | 307 | 8 | 37.6 |
| drag-multi | 278 | 182 | 40.1 | 200.3 | 32 | 47.9 |
| recolor-multi | 245 | 295 | 13.5 | 307 | 1 | 44.1 |
| recolor-single | 22 | 72 | 13.5 | 93.4 | 1 | 63.4 |
| column-flag | 52 | 102 | 13.4 | 120.2 | 1 | 60.6 |
| highlight-toggle | 220 | 172 | 40 | 186.9 | 6 | 50.5 |
| delete-columns | 27 | 73 | 13.4 | 120.2 | 1 | 60.3 |

## 500 tables · 8 columns · standard

Load+mount: 2730ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 23 | 61 | 26.7 | 53.4 | 6 | 65.1 |
| zoom-links-on | 14 | 61 | 26.8 | 80.1 | 7 | 59.2 |
| drag-single | 28 | 75 | 13.5 | 80.1 | 3 | 68.9 |
| select-multi | 126 | 99 | 26.7 | 147 | 4 | 49.5 |
| drag-multi | 46 | 84 | 26.7 | 93.5 | 3 | 63.8 |
| recolor-multi | 4 | 54 | 13.4 | 53.4 | 1 | 68.7 |
| recolor-single | 0 | 0 | 13.4 | 26.8 | 0 | 72.8 |
| column-flag | 14 | 64 | 13.5 | 93.4 | 1 | 63.7 |
| highlight-toggle | 200 | 126 | 40 | 213.7 | 6 | 51.5 |
| delete-columns | 0 | 0 | 13.4 | 26.7 | 0 | 72.7 |

## 500 tables · 8 columns · compact

Load+mount: 1086ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 26.7 | 40.1 | 1 | 68.5 |
| drag-single | 0 | 0 | 13.5 | 40 | 1 | 73.7 |
| select-multi | 5 | 55 | 13.5 | 53.4 | 2 | 69.2 |
| drag-multi | 0 | 0 | 13.5 | 40 | 1 | 73.7 |
| recolor-multi | 0 | 0 | 13.5 | 26.8 | 0 | 72.7 |
| recolor-single | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| column-flag | 6 | 56 | 13.4 | 53.4 | 1 | 68.7 |
| highlight-toggle | 32 | 82 | 13.5 | 80.1 | 1 | 69.9 |
| delete-columns | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |

## 100 tables · 4 columns · standard

Load+mount: 620ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| drag-single | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |
| select-multi | 0 | 0 | 13.4 | 13.5 | 0 | 75.4 |
| drag-multi | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| recolor-multi | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| recolor-single | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| column-flag | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| highlight-toggle | 0 | 0 | 13.5 | 26.7 | 0 | 73.1 |
| delete-columns | 0 | 0 | 13.4 | 13.4 | 0 | 74.9 |

## 100 tables · 16 columns · standard

Load+mount: 636ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.7 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| drag-single | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| select-multi | 0 | 0 | 13.5 | 26.8 | 0 | 73.4 |
| drag-multi | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| recolor-multi | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| recolor-single | 0 | 0 | 13.4 | 13.4 | 0 | 74.9 |
| column-flag | 0 | 0 | 13.4 | 26.7 | 0 | 72.7 |
| highlight-toggle | 0 | 0 | 13.5 | 26.8 | 0 | 73 |
| delete-columns | 0 | 0 | 13.5 | 13.5 | 0 | 74.9 |

## 100 tables · 32 columns · standard

Load+mount: 640ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.5 | 13.7 | 0 | 74.9 |
| zoom-links-on | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| drag-single | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| select-multi | 0 | 0 | 13.4 | 23.4 | 0 | 74.2 |
| drag-multi | 0 | 0 | 13.4 | 13.6 | 0 | 74.9 |
| recolor-multi | 0 | 0 | 13.4 | 13.5 | 0 | 74.9 |
| recolor-single | 0 | 0 | 13.5 | 13.6 | 0 | 74.9 |
| column-flag | 0 | 0 | 13.5 | 26.8 | 0 | 72.7 |
| highlight-toggle | 0 | 0 | 13.5 | 26.7 | 0 | 73.1 |
| delete-columns | 0 | 0 | 13.4 | 13.6 | 0 | 74.9 |
