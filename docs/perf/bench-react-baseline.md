# Canvas perf benchmark — `react-baseline`

Run: 2026-09-22T18:35:19.399Z · window 1600×900 · zoom 0.6

Per scenario: **blocking** = main-thread time in tasks over 50ms (the freeze proxy), **p95/worst** = frame interval, **drops** = frames over 33ms.

## 10 tables · 8 columns · full

Load+mount: 509ms (10 nodes, 9 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 7.1 | 48.8 | 1 | 136.2 |
| zoom-links-on | 0 | 0 | 7 | 14 | 0 | 143.3 |
| drag-single | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| select-multi | 0 | 0 | 7 | 14 | 0 | 140.6 |
| drag-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| recolor-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| recolor-single | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| column-flag | 0 | 0 | 7 | 7.1 | 0 | 143.8 |
| highlight-toggle | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| delete-columns | 0 | 0 | 7 | 14 | 0 | 141.5 |

## 10 tables · 8 columns · standard

Load+mount: 477ms (10 nodes, 9 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| zoom-links-on | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| drag-single | 0 | 0 | 7 | 7.1 | 0 | 144.1 |
| select-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| drag-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| recolor-multi | 0 | 0 | 7 | 7 | 0 | 143.8 |
| recolor-single | 0 | 0 | 7 | 7 | 0 | 143.9 |
| column-flag | 0 | 0 | 7 | 7 | 0 | 143.9 |
| highlight-toggle | 0 | 0 | 7 | 7.1 | 0 | 143.8 |
| delete-columns | 0 | 0 | 7 | 14 | 0 | 141.5 |

## 10 tables · 8 columns · compact

Load+mount: 464ms (10 nodes, 9 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 7 | 14.6 | 0 | 141.9 |
| zoom-links-on | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| drag-single | 0 | 0 | 7 | 7.1 | 0 | 144.2 |
| select-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| drag-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| recolor-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| recolor-single | 0 | 0 | 7 | 7.1 | 0 | 143.8 |
| column-flag | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| highlight-toggle | 0 | 0 | 7 | 7.1 | 0 | 143.8 |
| delete-columns | 0 | 0 | 7 | 7.1 | 0 | 143.8 |

## 50 tables · 8 columns · full

Load+mount: 751ms (50 nodes, 49 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 14 | 34.8 | 2 | 118.1 |
| zoom-links-on | 0 | 0 | 20.8 | 21 | 0 | 104.1 |
| drag-single | 0 | 0 | 7.1 | 13.8 | 0 | 142.4 |
| select-multi | 0 | 0 | 13.9 | 27.8 | 0 | 127.3 |
| drag-multi | 0 | 0 | 7 | 27.8 | 0 | 141 |
| recolor-multi | 0 | 0 | 7 | 27.8 | 0 | 137.3 |
| recolor-single | 0 | 0 | 7.1 | 7.2 | 0 | 143.9 |
| column-flag | 0 | 0 | 7 | 20.9 | 0 | 139.4 |
| highlight-toggle | 0 | 0 | 7 | 20.9 | 0 | 140.1 |
| delete-columns | 0 | 0 | 7.1 | 27.8 | 0 | 137 |

## 50 tables · 8 columns · standard

Load+mount: 553ms (50 nodes, 49 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 7.1 | 14 | 0 | 141.4 |
| zoom-links-on | 0 | 0 | 7.1 | 20.8 | 0 | 137 |
| drag-single | 0 | 0 | 7 | 14 | 0 | 143.4 |
| select-multi | 0 | 0 | 7.1 | 14 | 0 | 139.3 |
| drag-multi | 0 | 0 | 7 | 13.8 | 0 | 143.1 |
| recolor-multi | 0 | 0 | 7 | 7.1 | 0 | 143.8 |
| recolor-single | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| column-flag | 0 | 0 | 7 | 20.8 | 0 | 139.4 |
| highlight-toggle | 0 | 0 | 7 | 13.9 | 0 | 141 |
| delete-columns | 0 | 0 | 7 | 14 | 0 | 141.6 |

## 50 tables · 8 columns · compact

Load+mount: 517ms (50 nodes, 49 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 7 | 14 | 0 | 143.3 |
| zoom-links-on | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| drag-single | 0 | 0 | 7.1 | 7.1 | 0 | 143.8 |
| select-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| drag-multi | 0 | 0 | 7.1 | 7.1 | 0 | 143.9 |
| recolor-multi | 0 | 0 | 7.1 | 7.1 | 0 | 143.8 |
| recolor-single | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| column-flag | 0 | 0 | 7 | 13.9 | 0 | 141.5 |
| highlight-toggle | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| delete-columns | 0 | 0 | 7.1 | 14 | 0 | 141.6 |

## 100 tables · 8 columns · full

Load+mount: 1277ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 76 | 74 | 27.7 | 76.5 | 8 | 96.9 |
| zoom-links-on | 0 | 0 | 27.9 | 48.6 | 8 | 82 |
| drag-single | 0 | 0 | 13.9 | 27.8 | 0 | 130.2 |
| select-multi | 4 | 54 | 14 | 62.6 | 3 | 114.6 |
| drag-multi | 2 | 52 | 13.9 | 48.6 | 1 | 119.2 |
| recolor-multi | 0 | 0 | 7 | 41.8 | 1 | 132.9 |
| recolor-single | 0 | 0 | 7.1 | 20.9 | 0 | 139.3 |
| column-flag | 0 | 0 | 7 | 34.7 | 1 | 135 |
| highlight-toggle | 0 | 0 | 7 | 34.7 | 1 | 138.3 |
| delete-columns | 0 | 0 | 7 | 41.7 | 1 | 133 |

## 100 tables · 8 columns · standard

Load+mount: 716ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 7.1 | 34.9 | 3 | 129.1 |
| zoom-links-on | 0 | 0 | 20.8 | 48.6 | 2 | 110.4 |
| drag-single | 0 | 0 | 7 | 13.9 | 0 | 142.4 |
| select-multi | 0 | 0 | 13.9 | 27.8 | 0 | 129.1 |
| drag-multi | 0 | 0 | 7 | 13.9 | 0 | 142.4 |
| recolor-multi | 0 | 0 | 7 | 13.9 | 0 | 141.6 |
| recolor-single | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| column-flag | 0 | 0 | 7 | 27.8 | 0 | 135.2 |
| highlight-toggle | 0 | 0 | 7 | 27.8 | 0 | 138.2 |
| delete-columns | 0 | 0 | 7.1 | 20.8 | 0 | 139.4 |

## 100 tables · 8 columns · compact

Load+mount: 562ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 7.1 | 20.9 | 0 | 138 |
| zoom-links-on | 0 | 0 | 7 | 13.9 | 0 | 143.3 |
| drag-single | 0 | 0 | 7 | 7.1 | 0 | 143.8 |
| select-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| drag-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| recolor-multi | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| recolor-single | 0 | 0 | 7 | 7 | 0 | 143.9 |
| column-flag | 0 | 0 | 7 | 13.8 | 0 | 141.5 |
| highlight-toggle | 0 | 0 | 7 | 27.8 | 0 | 140.9 |
| delete-columns | 0 | 0 | 7.1 | 14 | 0 | 139.4 |

## 200 tables · 8 columns · full

Load+mount: 710ms (200 nodes, 199 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.8 | 34.8 | 2 | 125.4 |
| zoom-links-on | 0 | 0 | 13.9 | 55.8 | 1 | 128.8 |
| drag-single | 0 | 0 | 7 | 20.9 | 0 | 141 |
| select-multi | 0 | 0 | 7 | 14 | 0 | 139.6 |
| drag-multi | 0 | 0 | 7.1 | 20.9 | 0 | 136 |
| recolor-multi | 0 | 0 | 7 | 21.1 | 0 | 139.2 |
| recolor-single | 0 | 0 | 7 | 13.9 | 0 | 141.6 |
| column-flag | 0 | 0 | 7 | 41.8 | 1 | 133 |
| highlight-toggle | 0 | 0 | 7 | 48.7 | 1 | 136.4 |
| delete-columns | 0 | 0 | 7 | 34.7 | 1 | 135.2 |

## 200 tables · 8 columns · standard

Load+mount: 717ms (200 nodes, 199 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 7.1 | 34.8 | 3 | 125.7 |
| zoom-links-on | 0 | 0 | 13.9 | 21 | 0 | 131.9 |
| drag-single | 0 | 0 | 7.1 | 41.7 | 1 | 138.2 |
| select-multi | 0 | 0 | 7 | 13.9 | 0 | 139.4 |
| drag-multi | 0 | 0 | 7.1 | 48.7 | 1 | 133.4 |
| recolor-multi | 0 | 0 | 7.1 | 14 | 0 | 141.6 |
| recolor-single | 0 | 0 | 7.1 | 7.1 | 0 | 143.8 |
| column-flag | 0 | 0 | 7 | 41.8 | 1 | 133.3 |
| highlight-toggle | 0 | 0 | 7 | 41.8 | 1 | 137.4 |
| delete-columns | 0 | 0 | 7.1 | 27.8 | 0 | 137.2 |

## 200 tables · 8 columns · compact

Load+mount: 698ms (200 nodes, 199 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.8 | 41.7 | 3 | 125 |
| zoom-links-on | 0 | 0 | 13.9 | 20.8 | 0 | 133.1 |
| drag-single | 0 | 0 | 7.1 | 27.7 | 0 | 135.3 |
| select-multi | 0 | 0 | 7 | 14 | 0 | 139.7 |
| drag-multi | 0 | 0 | 7.1 | 27.8 | 0 | 136.9 |
| recolor-multi | 0 | 0 | 7 | 13.9 | 0 | 141.5 |
| recolor-single | 0 | 0 | 7 | 13.9 | 0 | 141.6 |
| column-flag | 0 | 0 | 7 | 34.7 | 1 | 135.1 |
| highlight-toggle | 0 | 0 | 7.1 | 48.8 | 1 | 136.4 |
| delete-columns | 0 | 0 | 7 | 34.7 | 1 | 135.2 |

## 500 tables · 8 columns · full

Load+mount: 1515ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 113 | 76 | 27.8 | 76.5 | 10 | 89.6 |
| zoom-links-on | 4 | 54 | 41.7 | 55.7 | 16 | 68.8 |
| drag-single | 29 | 79 | 27.9 | 104.3 | 8 | 96.6 |
| select-multi | 0 | 0 | 13.9 | 41.7 | 3 | 119.4 |
| drag-multi | 15 | 65 | 27.8 | 83.5 | 2 | 105.2 |
| recolor-multi | 0 | 0 | 7 | 41.7 | 1 | 131.1 |
| recolor-single | 0 | 0 | 7.1 | 48.7 | 1 | 129 |
| column-flag | 31 | 81 | 7.1 | 90.4 | 1 | 120.9 |
| highlight-toggle | 70 | 111 | 13.9 | 118.2 | 2 | 110.1 |
| delete-columns | 19 | 69 | 7.1 | 76.5 | 1 | 121.9 |

## 500 tables · 8 columns · standard

Load+mount: 1448ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 57 | 64 | 21 | 62.6 | 10 | 92.5 |
| zoom-links-on | 0 | 0 | 41.7 | 48.8 | 16 | 75.4 |
| drag-single | 22 | 72 | 20.9 | 90.3 | 2 | 106.8 |
| select-multi | 0 | 0 | 21 | 41.7 | 6 | 118 |
| drag-multi | 26 | 76 | 27.8 | 111.3 | 3 | 103.1 |
| recolor-multi | 0 | 0 | 7 | 41.8 | 1 | 131.1 |
| recolor-single | 0 | 0 | 7.1 | 41.8 | 1 | 131.1 |
| column-flag | 25 | 75 | 7 | 83.4 | 1 | 122.3 |
| highlight-toggle | 78 | 119 | 13.9 | 125.1 | 2 | 109.3 |
| delete-columns | 16 | 66 | 7 | 76.5 | 1 | 121.9 |

## 500 tables · 8 columns · compact

Load+mount: 1470ms (500 nodes, 499 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 53 | 64 | 21 | 69.6 | 10 | 94.3 |
| zoom-links-on | 8 | 56 | 41.7 | 55.7 | 16 | 75.4 |
| drag-single | 20 | 70 | 20.9 | 90.3 | 2 | 106.6 |
| select-multi | 0 | 0 | 14 | 34.8 | 1 | 119.9 |
| drag-multi | 22 | 72 | 27.8 | 97.3 | 5 | 100.5 |
| recolor-multi | 0 | 0 | 7 | 41.7 | 1 | 131.3 |
| recolor-single | 0 | 0 | 7.1 | 41.7 | 1 | 131.2 |
| column-flag | 24 | 74 | 7.1 | 83.5 | 1 | 120.2 |
| highlight-toggle | 55 | 102 | 14 | 104.2 | 2 | 114.6 |
| delete-columns | 15 | 65 | 7 | 76.5 | 1 | 124.3 |

## 100 tables · 4 columns · standard

Load+mount: 689ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 13.8 | 34.8 | 2 | 127.1 |
| zoom-links-on | 0 | 0 | 14 | 48.8 | 5 | 111.1 |
| drag-single | 0 | 0 | 7 | 13.9 | 0 | 143.1 |
| select-multi | 0 | 0 | 7.1 | 34.8 | 1 | 131.4 |
| drag-multi | 0 | 0 | 7 | 20.9 | 0 | 142.4 |
| recolor-multi | 0 | 0 | 7.1 | 13.9 | 0 | 141.5 |
| recolor-single | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| column-flag | 0 | 0 | 7 | 27.8 | 0 | 137.1 |
| highlight-toggle | 0 | 0 | 7 | 34.8 | 1 | 138.2 |
| delete-columns | 0 | 0 | 7 | 20.8 | 0 | 139.3 |

## 100 tables · 16 columns · standard

Load+mount: 712ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 7.1 | 27.8 | 0 | 131.4 |
| zoom-links-on | 0 | 0 | 14 | 34.8 | 2 | 113.8 |
| drag-single | 0 | 0 | 7 | 13.9 | 0 | 142.4 |
| select-multi | 0 | 0 | 7.1 | 21 | 0 | 134.3 |
| drag-multi | 0 | 0 | 7 | 20.9 | 0 | 141.7 |
| recolor-multi | 0 | 0 | 7.1 | 14 | 0 | 141.6 |
| recolor-single | 0 | 0 | 7 | 7.1 | 0 | 143.9 |
| column-flag | 0 | 0 | 7.1 | 41.6 | 1 | 133 |
| highlight-toggle | 0 | 0 | 7 | 27.8 | 0 | 138.1 |
| delete-columns | 0 | 0 | 7 | 27.8 | 0 | 137.3 |

## 100 tables · 32 columns · standard

Load+mount: 702ms (100 nodes, 99 edges in DOM)

| scenario | blocking ms | longtask max | frame p95 | worst frame | drops | fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 | 0 | 7.1 | 34.7 | 2 | 129.8 |
| zoom-links-on | 0 | 0 | 14 | 41.8 | 3 | 110.4 |
| drag-single | 0 | 0 | 7 | 13.9 | 0 | 142.7 |
| select-multi | 0 | 0 | 7.1 | 27.8 | 0 | 134.5 |
| drag-multi | 0 | 0 | 7 | 20.9 | 0 | 142.4 |
| recolor-multi | 0 | 0 | 7 | 14 | 0 | 141.6 |
| recolor-single | 0 | 0 | 7.1 | 7.1 | 0 | 143.9 |
| column-flag | 0 | 0 | 7 | 22.4 | 0 | 138.8 |
| highlight-toggle | 0 | 0 | 7 | 34.8 | 1 | 137.3 |
| delete-columns | 0 | 0 | 7.1 | 27.8 | 0 | 137.3 |
