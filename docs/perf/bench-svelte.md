# Canvas perf benchmark — `svelte`

Run: 2026-09-22T19:39:01.357Z · window 1600×900 · zoom 0.6

Per scenario: **blocking** = main-thread time in tasks over 50ms (the freeze proxy), **p95/worst** = frame interval, **drops** = frames over 33ms.

## 10 tables · 8 columns · full

Load+mount: 301ms (10 nodes, 9 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 7 | 20.8 | 0 | 141.4 |
| zoom-links-on | 0 | 0 | 7.1 | 20.9 | 0 | 141.3 |
| drag-single | 0 | 0 | 7 | 7.1 | 0 | 143.8 |
| select-multi | 0 | 0 | 7.1 | 13.9 | 0 | 141.6 |
| drag-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| recolor-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| recolor-single | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| column-flag | 0 | 0 | 7.1 | 7.2 | 0 | 143.9 |
| highlight-toggle | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| delete-columns | 0 | 0 | 7 | 14 | 0 | 141.6 |

## 10 tables · 8 columns · standard

Load+mount: 251ms (10 nodes, 9 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 7.1 | 13.9 | 0 | 140.7 |
| zoom-links-on | 0 | 0 | 7.1 | 7.2 | 0 | 143.9 |
| drag-single | 0 | 0 | 7.1 | 7.2 | 0 | 143.8 |
| select-multi | 0 | 0 | 7.1 | 7.1 | 0 | 143.9 |
| drag-multi | 0 | 0 | 7.1 | 7.1 | 0 | 143.9 |
| recolor-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| recolor-single | 0 | 0 | 7 | 7.1 | 0 | 143.8 |
| column-flag | 0 | 0 | 7.1 | 13.9 | 0 | 141.6 |
| highlight-toggle | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| delete-columns | 0 | 0 | 7 | 7.1 | 0 | 143.9 |

## 10 tables · 8 columns · compact

Load+mount: 214ms (10 nodes, 9 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 7 | 13.8 | 0 | 142 |
| zoom-links-on | 0 | 0 | 7.1 | 7.2 | 0 | 143.9 |
| drag-single | 0 | 0 | 7.1 | 12 | 0 | 143.4 |
| select-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| drag-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| recolor-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| recolor-single | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| column-flag | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| highlight-toggle | 0 | 0 | 7.1 | 7.2 | 0 | 143.9 |
| delete-columns | 0 | 0 | 7 | 7.1 | 0 | 143.8 |

## 50 tables · 8 columns · full

Load+mount: 562ms (50 nodes, 49 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 20.8 | 27.8 | 0 | 114 |
| zoom-links-on | 0 | 0 | 20.9 | 41.6 | 2 | 95.1 |
| drag-single | 0 | 0 | 7 | 13.9 | 0 | 143.2 |
| select-multi | 0 | 0 | 7.3 | 20.9 | 0 | 135.9 |
| drag-multi | 0 | 0 | 7.1 | 13.9 | 0 | 143.2 |
| recolor-multi | 0 | 0 | 7.1 | 7.2 | 0 | 143.9 |
| recolor-single | 0 | 0 | 7 | 7 | 0 | 143.9 |
| column-flag | 0 | 0 | 7 | 7 | 0 | 144.8 |
| highlight-toggle | 0 | 0 | 7 | 27.9 | 0 | 140 |
| delete-columns | 0 | 0 | 7 | 27.8 | 0 | 137.2 |

## 50 tables · 8 columns · standard

Load+mount: 364ms (50 nodes, 49 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 7.1 | 14.4 | 0 | 137.5 |
| zoom-links-on | 0 | 0 | 13.9 | 21.1 | 0 | 131.4 |
| drag-single | 0 | 0 | 7 | 7.2 | 0 | 143.8 |
| select-multi | 0 | 0 | 7.1 | 13.9 | 0 | 141.6 |
| drag-multi | 0 | 0 | 7 | 7.2 | 0 | 143.8 |
| recolor-multi | 0 | 0 | 7 | 7.2 | 0 | 143.9 |
| recolor-single | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| column-flag | 0 | 0 | 7.1 | 14 | 0 | 139.4 |
| highlight-toggle | 0 | 0 | 7.1 | 20.9 | 0 | 139 |
| delete-columns | 0 | 0 | 7 | 7.2 | 0 | 144.8 |

## 50 tables · 8 columns · compact

Load+mount: 283ms (50 nodes, 49 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 7.1 | 13.9 | 0 | 140.1 |
| zoom-links-on | 0 | 0 | 7.1 | 13.9 | 0 | 143.3 |
| drag-single | 0 | 0 | 7.1 | 7.2 | 0 | 143.8 |
| select-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| drag-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| recolor-multi | 0 | 0 | 7 | 7 | 0 | 143.8 |
| recolor-single | 0 | 0 | 7 | 7 | 0 | 143.9 |
| column-flag | 0 | 0 | 7.1 | 13.8 | 0 | 141.6 |
| highlight-toggle | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| delete-columns | 0 | 0 | 7.1 | 7.1 | 0 | 143.9 |

## 100 tables · 8 columns · full

Load+mount: 807ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 18 | 58 | 41.6 | 62.6 | 16 | 80.8 |
| zoom-links-on | 29 | 65 | 41.7 | 76.5 | 18 | 74.5 |
| drag-single | 0 | 0 | 7.1 | 20.8 | 0 | 140.6 |
| select-multi | 0 | 0 | 13.8 | 20.9 | 0 | 134.2 |
| drag-multi | 0 | 0 | 7.1 | 14 | 0 | 141.3 |
| recolor-multi | 0 | 0 | 7 | 13.9 | 0 | 141.6 |
| recolor-single | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| column-flag | 0 | 0 | 7.1 | 20.9 | 0 | 137.3 |
| highlight-toggle | 0 | 0 | 7.1 | 34.8 | 1 | 135.7 |
| delete-columns | 0 | 0 | 7 | 34.8 | 1 | 135.1 |

## 100 tables · 8 columns · standard

Load+mount: 500ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 14 | 34.8 | 1 | 120.5 |
| zoom-links-on | 0 | 0 | 20.9 | 27.9 | 0 | 102.7 |
| drag-single | 0 | 0 | 7.1 | 13.9 | 0 | 142.4 |
| select-multi | 0 | 0 | 7.1 | 14.1 | 0 | 138.4 |
| drag-multi | 0 | 0 | 7 | 14 | 0 | 143.1 |
| recolor-multi | 0 | 0 | 7 | 7.1 | 0 | 143.8 |
| recolor-single | 0 | 0 | 7 | 7.1 | 0 | 143.8 |
| column-flag | 0 | 0 | 7 | 34.8 | 1 | 135.2 |
| highlight-toggle | 0 | 0 | 7.1 | 27.9 | 0 | 138.1 |
| delete-columns | 0 | 0 | 7 | 27.8 | 0 | 137.2 |

## 100 tables · 8 columns · compact

Load+mount: 374ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 7.3 | 20.9 | 0 | 136.3 |
| zoom-links-on | 0 | 0 | 7.1 | 14 | 0 | 140.8 |
| drag-single | 0 | 0 | 7 | 13.9 | 0 | 143.1 |
| select-multi | 0 | 0 | 7 | 7.1 | 0 | 143.8 |
| drag-multi | 0 | 0 | 7 | 7.3 | 0 | 143.9 |
| recolor-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| recolor-single | 0 | 0 | 7 | 7.2 | 0 | 143.9 |
| column-flag | 0 | 0 | 7.1 | 13.9 | 0 | 141.7 |
| highlight-toggle | 0 | 0 | 7 | 20.9 | 0 | 141.9 |
| delete-columns | 0 | 0 | 7 | 21 | 0 | 139.4 |

## 200 tables · 8 columns · full

Load+mount: 518ms (200 nodes, 199 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.9 | 34.8 | 1 | 129.1 |
| zoom-links-on | 0 | 0 | 13.9 | 20.9 | 0 | 129.3 |
| drag-single | 0 | 0 | 7 | 20.9 | 0 | 142.7 |
| select-multi | 0 | 0 | 7 | 7.1 | 0 | 143.8 |
| drag-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| recolor-multi | 0 | 0 | 7.1 | 13.8 | 0 | 141.6 |
| recolor-single | 0 | 0 | 7 | 7.1 | 0 | 143.8 |
| column-flag | 0 | 0 | 7.1 | 34.8 | 1 | 135.1 |
| highlight-toggle | 0 | 0 | 7.1 | 41.8 | 1 | 135.5 |
| delete-columns | 0 | 0 | 7 | 34.8 | 1 | 135.1 |

## 200 tables · 8 columns · standard

Load+mount: 483ms (200 nodes, 199 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.9 | 27.8 | 0 | 130.4 |
| zoom-links-on | 0 | 0 | 13.9 | 27.8 | 0 | 126.8 |
| drag-single | 0 | 0 | 7 | 27.8 | 0 | 141.3 |
| select-multi | 0 | 0 | 7.1 | 7.3 | 0 | 143.9 |
| drag-multi | 0 | 0 | 7.1 | 13.8 | 0 | 143.1 |
| recolor-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| recolor-single | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| column-flag | 0 | 0 | 7 | 7.1 | 0 | 145.7 |
| highlight-toggle | 0 | 0 | 7.1 | 41.7 | 1 | 138.3 |
| delete-columns | 0 | 0 | 7.1 | 27.7 | 0 | 137.3 |

## 200 tables · 8 columns · compact

Load+mount: 485ms (200 nodes, 199 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.8 | 34.7 | 1 | 131.2 |
| zoom-links-on | 0 | 0 | 13.9 | 20.9 | 0 | 126.3 |
| drag-single | 0 | 0 | 7.1 | 27.9 | 0 | 141.7 |
| select-multi | 0 | 0 | 7 | 7.2 | 0 | 143.9 |
| drag-multi | 0 | 0 | 7 | 13.9 | 0 | 143.1 |
| recolor-multi | 0 | 0 | 7.1 | 7.2 | 0 | 143.9 |
| recolor-single | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| column-flag | 0 | 0 | 7 | 8.4 | 0 | 143.4 |
| highlight-toggle | 0 | 0 | 7 | 41.7 | 1 | 137.4 |
| delete-columns | 0 | 0 | 7.1 | 34.9 | 1 | 135.1 |

## 500 tables · 8 columns · full

Load+mount: 1019ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 15 | 56 | 21 | 55.7 | 10 | 104.6 |
| zoom-links-on | 40 | 90 | 27.8 | 83.3 | 8 | 94.7 |
| drag-single | 0 | 0 | 7 | 48.6 | 1 | 140 |
| select-multi | 0 | 0 | 7 | 13.9 | 0 | 142.8 |
| drag-multi | 0 | 0 | 7.1 | 27.9 | 0 | 141.7 |
| recolor-multi | 0 | 0 | 7 | 27.8 | 0 | 137.3 |
| recolor-single | 0 | 0 | 7.1 | 27.7 | 0 | 137.1 |
| column-flag | 11 | 61 | 7 | 62.5 | 1 | 127.2 |
| highlight-toggle | 40 | 90 | 7 | 90.3 | 2 | 129 |
| delete-columns | 25 | 75 | 7 | 69.5 | 1 | 124.1 |

## 500 tables · 8 columns · standard

Load+mount: 839ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 3 | 53 | 14 | 48.7 | 4 | 112.7 |
| zoom-links-on | 0 | 50 | 34.7 | 48.7 | 13 | 90.6 |
| drag-single | 0 | 50 | 7 | 48.6 | 1 | 139.6 |
| select-multi | 0 | 0 | 7 | 14 | 0 | 142.8 |
| drag-multi | 0 | 0 | 7 | 27.7 | 0 | 141.7 |
| recolor-multi | 0 | 0 | 7 | 41.5 | 1 | 133.2 |
| recolor-single | 0 | 0 | 7.1 | 20.8 | 0 | 137.1 |
| column-flag | 17 | 67 | 7 | 62.5 | 1 | 127.6 |
| highlight-toggle | 35 | 85 | 7.1 | 83.4 | 2 | 129.3 |
| delete-columns | 22 | 72 | 7 | 69.5 | 1 | 125.6 |

## 500 tables · 8 columns · compact

Load+mount: 808ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.9 | 48.7 | 4 | 112.1 |
| zoom-links-on | 0 | 0 | 27.9 | 48.7 | 11 | 97.3 |
| drag-single | 3 | 53 | 7 | 48.6 | 1 | 139.6 |
| select-multi | 0 | 0 | 7 | 13.9 | 0 | 142.8 |
| drag-multi | 0 | 0 | 7 | 20.9 | 0 | 141.1 |
| recolor-multi | 0 | 0 | 7 | 34.7 | 1 | 135.2 |
| recolor-single | 0 | 0 | 7 | 27.9 | 0 | 137.3 |
| column-flag | 18 | 68 | 7 | 7.1 | 0 | 145.2 |
| highlight-toggle | 36 | 86 | 13.9 | 90.4 | 2 | 112.9 |
| delete-columns | 19 | 69 | 7.1 | 9.8 | 0 | 142.9 |

## 100 tables · 4 columns · standard

Load+mount: 524ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.8 | 27.8 | 0 | 131.8 |
| zoom-links-on | 0 | 0 | 20.9 | 34.7 | 1 | 106.3 |
| drag-single | 0 | 0 | 7 | 7.1 | 0 | 144.1 |
| select-multi | 0 | 0 | 7 | 14 | 0 | 140.6 |
| drag-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| recolor-multi | 0 | 0 | 7 | 7.1 | 0 | 143.8 |
| recolor-single | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| column-flag | 0 | 0 | 7 | 20.9 | 0 | 139.3 |
| highlight-toggle | 0 | 0 | 7 | 20.9 | 0 | 139.1 |
| delete-columns | 0 | 0 | 7 | 20.8 | 0 | 139.4 |

## 100 tables · 16 columns · standard

Load+mount: 475ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.9 | 34.7 | 1 | 129.9 |
| zoom-links-on | 0 | 0 | 20.8 | 34.6 | 1 | 104 |
| drag-single | 0 | 0 | 7 | 13.8 | 0 | 143.1 |
| select-multi | 0 | 0 | 7 | 13.9 | 0 | 140.8 |
| drag-multi | 0 | 0 | 7 | 13.9 | 0 | 143.1 |
| recolor-multi | 0 | 0 | 7 | 7.2 | 0 | 143.9 |
| recolor-single | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| column-flag | 0 | 0 | 7 | 34.9 | 1 | 135.1 |
| highlight-toggle | 0 | 0 | 7 | 27.9 | 0 | 138.1 |
| delete-columns | 0 | 0 | 7.1 | 20.9 | 0 | 137.1 |

## 100 tables · 32 columns · standard

Load+mount: 511ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.9 | 27.8 | 0 | 129.2 |
| zoom-links-on | 0 | 0 | 20.8 | 27.9 | 0 | 109.5 |
| drag-single | 0 | 0 | 7 | 14 | 0 | 143.1 |
| select-multi | 0 | 0 | 7 | 14 | 0 | 141.6 |
| drag-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| recolor-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| recolor-single | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| column-flag | 0 | 0 | 7 | 48.6 | 1 | 131.2 |
| highlight-toggle | 0 | 0 | 7.1 | 20.9 | 0 | 139 |
| delete-columns | 0 | 0 | 7 | 8.4 | 0 | 143.4 |
