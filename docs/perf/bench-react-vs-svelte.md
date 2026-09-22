# Canvas perf — `react-baseline` → `svelte`

## 10 tables · 8 columns · full

Load+mount: 509ms → 301ms (-41%)

| scenario | blocking ms | Δ | frame p95 | worst frame | drops |
| --- | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 → 0 | = | 7.1 → 7 | 48.8 → 20.8 | 1 → 0 |
| zoom-links-on | 0 → 0 | = | 7 → 7.1 | 14 → 20.9 | 0 → 0 |
| drag-single | 0 → 0 | = | 7 → 7 | 7.1 → 7.1 | 0 → 0 |
| select-multi | 0 → 0 | = | 7 → 7.1 | 14 → 13.9 | 0 → 0 |
| drag-multi | 0 → 0 | = | 7 → 7 | 7.1 → 7.1 | 0 → 0 |
| recolor-multi | 0 → 0 | = | 7 → 7 | 7.1 → 7.1 | 0 → 0 |
| recolor-single | 0 → 0 | = | 7 → 7 | 7.1 → 7.1 | 0 → 0 |
| column-flag | 0 → 0 | = | 7 → 7.1 | 7.1 → 7.2 | 0 → 0 |
| highlight-toggle | 0 → 0 | = | 7 → 7 | 7.1 → 7.1 | 0 → 0 |
| delete-columns | 0 → 0 | = | 7 → 7 | 14 → 14 | 0 → 0 |

## 10 tables · 8 columns · standard

Load+mount: 477ms → 251ms (-47%)

| scenario | blocking ms | Δ | frame p95 | worst frame | drops |
| --- | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 → 0 | = | 7 → 7.1 | 7.1 → 13.9 | 0 → 0 |
| zoom-links-on | 0 → 0 | = | 7 → 7.1 | 7.1 → 7.2 | 0 → 0 |
| drag-single | 0 → 0 | = | 7 → 7.1 | 7.1 → 7.2 | 0 → 0 |
| select-multi | 0 → 0 | = | 7 → 7.1 | 7.1 → 7.1 | 0 → 0 |
| drag-multi | 0 → 0 | = | 7 → 7.1 | 7.1 → 7.1 | 0 → 0 |
| recolor-multi | 0 → 0 | = | 7 → 7 | 7 → 7.1 | 0 → 0 |
| recolor-single | 0 → 0 | = | 7 → 7 | 7 → 7.1 | 0 → 0 |
| column-flag | 0 → 0 | = | 7 → 7.1 | 7 → 13.9 | 0 → 0 |
| highlight-toggle | 0 → 0 | = | 7 → 7 | 7.1 → 7.1 | 0 → 0 |
| delete-columns | 0 → 0 | = | 7 → 7 | 14 → 7.1 | 0 → 0 |

## 10 tables · 8 columns · compact

Load+mount: 464ms → 214ms (-54%)

| scenario | blocking ms | Δ | frame p95 | worst frame | drops |
| --- | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 → 0 | = | 7 → 7 | 14.6 → 13.8 | 0 → 0 |
| zoom-links-on | 0 → 0 | = | 7 → 7.1 | 7.1 → 7.2 | 0 → 0 |
| drag-single | 0 → 0 | = | 7 → 7.1 | 7.1 → 12 | 0 → 0 |
| select-multi | 0 → 0 | = | 7 → 7 | 7.1 → 7.1 | 0 → 0 |
| drag-multi | 0 → 0 | = | 7 → 7 | 7.1 → 7.1 | 0 → 0 |
| recolor-multi | 0 → 0 | = | 7 → 7 | 7.1 → 7.1 | 0 → 0 |
| recolor-single | 0 → 0 | = | 7 → 7 | 7.1 → 7.1 | 0 → 0 |
| column-flag | 0 → 0 | = | 7 → 7 | 7.1 → 7.1 | 0 → 0 |
| highlight-toggle | 0 → 0 | = | 7 → 7.1 | 7.1 → 7.2 | 0 → 0 |
| delete-columns | 0 → 0 | = | 7 → 7 | 7.1 → 7.1 | 0 → 0 |

## 50 tables · 8 columns · full

Load+mount: 751ms → 562ms (-25%)

| scenario | blocking ms | Δ | frame p95 | worst frame | drops |
| --- | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 → 0 | = | 14 → 20.8 | 34.8 → 27.8 | 2 → 0 |
| zoom-links-on | 0 → 0 | = | 20.8 → 20.9 | 21 → 41.6 | 0 → 2 |
| drag-single | 0 → 0 | = | 7.1 → 7 | 13.8 → 13.9 | 0 → 0 |
| select-multi | 0 → 0 | = | 13.9 → 7.3 | 27.8 → 20.9 | 0 → 0 |
| drag-multi | 0 → 0 | = | 7 → 7.1 | 27.8 → 13.9 | 0 → 0 |
| recolor-multi | 0 → 0 | = | 7 → 7.1 | 27.8 → 7.2 | 0 → 0 |
| recolor-single | 0 → 0 | = | 7.1 → 7 | 7.2 → 7 | 0 → 0 |
| column-flag | 0 → 0 | = | 7 → 7 | 20.9 → 7 | 0 → 0 |
| highlight-toggle | 0 → 0 | = | 7 → 7 | 20.9 → 27.9 | 0 → 0 |
| delete-columns | 0 → 0 | = | 7.1 → 7 | 27.8 → 27.8 | 0 → 0 |

## 50 tables · 8 columns · standard

Load+mount: 553ms → 364ms (-34%)

| scenario | blocking ms | Δ | frame p95 | worst frame | drops |
| --- | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 → 0 | = | 7.1 → 7.1 | 14 → 14.4 | 0 → 0 |
| zoom-links-on | 0 → 0 | = | 7.1 → 13.9 | 20.8 → 21.1 | 0 → 0 |
| drag-single | 0 → 0 | = | 7 → 7 | 14 → 7.2 | 0 → 0 |
| select-multi | 0 → 0 | = | 7.1 → 7.1 | 14 → 13.9 | 0 → 0 |
| drag-multi | 0 → 0 | = | 7 → 7 | 13.8 → 7.2 | 0 → 0 |
| recolor-multi | 0 → 0 | = | 7 → 7 | 7.1 → 7.2 | 0 → 0 |
| recolor-single | 0 → 0 | = | 7 → 7 | 7.1 → 7.1 | 0 → 0 |
| column-flag | 0 → 0 | = | 7 → 7.1 | 20.8 → 14 | 0 → 0 |
| highlight-toggle | 0 → 0 | = | 7 → 7.1 | 13.9 → 20.9 | 0 → 0 |
| delete-columns | 0 → 0 | = | 7 → 7 | 14 → 7.2 | 0 → 0 |

## 50 tables · 8 columns · compact

Load+mount: 517ms → 283ms (-45%)

| scenario | blocking ms | Δ | frame p95 | worst frame | drops |
| --- | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 → 0 | = | 7 → 7.1 | 14 → 13.9 | 0 → 0 |
| zoom-links-on | 0 → 0 | = | 7 → 7.1 | 7.1 → 13.9 | 0 → 0 |
| drag-single | 0 → 0 | = | 7.1 → 7.1 | 7.1 → 7.2 | 0 → 0 |
| select-multi | 0 → 0 | = | 7 → 7 | 7.1 → 7.1 | 0 → 0 |
| drag-multi | 0 → 0 | = | 7.1 → 7 | 7.1 → 7.1 | 0 → 0 |
| recolor-multi | 0 → 0 | = | 7.1 → 7 | 7.1 → 7 | 0 → 0 |
| recolor-single | 0 → 0 | = | 7 → 7 | 7.1 → 7 | 0 → 0 |
| column-flag | 0 → 0 | = | 7 → 7.1 | 13.9 → 13.8 | 0 → 0 |
| highlight-toggle | 0 → 0 | = | 7 → 7 | 7.1 → 7.1 | 0 → 0 |
| delete-columns | 0 → 0 | = | 7.1 → 7.1 | 14 → 7.1 | 0 → 0 |

## 100 tables · 8 columns · full

Load+mount: 1277ms → 807ms (-37%)

| scenario | blocking ms | Δ | frame p95 | worst frame | drops |
| --- | ---: | ---: | ---: | ---: | ---: |
| zoom | 76 → 18 | -76% | 27.7 → 41.6 | 76.5 → 62.6 | 8 → 16 |
| zoom-links-on | 0 → 29 | +∞ | 27.9 → 41.7 | 48.6 → 76.5 | 8 → 18 |
| drag-single | 0 → 0 | = | 13.9 → 7.1 | 27.8 → 20.8 | 0 → 0 |
| select-multi | 4 → 0 | -100% | 14 → 13.8 | 62.6 → 20.9 | 3 → 0 |
| drag-multi | 2 → 0 | -100% | 13.9 → 7.1 | 48.6 → 14 | 1 → 0 |
| recolor-multi | 0 → 0 | = | 7 → 7 | 41.8 → 13.9 | 1 → 0 |
| recolor-single | 0 → 0 | = | 7.1 → 7 | 20.9 → 7.1 | 0 → 0 |
| column-flag | 0 → 0 | = | 7 → 7.1 | 34.7 → 20.9 | 1 → 0 |
| highlight-toggle | 0 → 0 | = | 7 → 7.1 | 34.7 → 34.8 | 1 → 1 |
| delete-columns | 0 → 0 | = | 7 → 7 | 41.7 → 34.8 | 1 → 1 |

## 100 tables · 8 columns · standard

Load+mount: 716ms → 500ms (-30%)

| scenario | blocking ms | Δ | frame p95 | worst frame | drops |
| --- | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 → 0 | = | 7.1 → 14 | 34.9 → 34.8 | 3 → 1 |
| zoom-links-on | 0 → 0 | = | 20.8 → 20.9 | 48.6 → 27.9 | 2 → 0 |
| drag-single | 0 → 0 | = | 7 → 7.1 | 13.9 → 13.9 | 0 → 0 |
| select-multi | 0 → 0 | = | 13.9 → 7.1 | 27.8 → 14.1 | 0 → 0 |
| drag-multi | 0 → 0 | = | 7 → 7 | 13.9 → 14 | 0 → 0 |
| recolor-multi | 0 → 0 | = | 7 → 7 | 13.9 → 7.1 | 0 → 0 |
| recolor-single | 0 → 0 | = | 7 → 7 | 7.1 → 7.1 | 0 → 0 |
| column-flag | 0 → 0 | = | 7 → 7 | 27.8 → 34.8 | 0 → 1 |
| highlight-toggle | 0 → 0 | = | 7 → 7.1 | 27.8 → 27.9 | 0 → 0 |
| delete-columns | 0 → 0 | = | 7.1 → 7 | 20.8 → 27.8 | 0 → 0 |

## 100 tables · 8 columns · compact

Load+mount: 562ms → 374ms (-33%)

| scenario | blocking ms | Δ | frame p95 | worst frame | drops |
| --- | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 → 0 | = | 7.1 → 7.3 | 20.9 → 20.9 | 0 → 0 |
| zoom-links-on | 0 → 0 | = | 7 → 7.1 | 13.9 → 14 | 0 → 0 |
| drag-single | 0 → 0 | = | 7 → 7 | 7.1 → 13.9 | 0 → 0 |
| select-multi | 0 → 0 | = | 7 → 7 | 7.1 → 7.1 | 0 → 0 |
| drag-multi | 0 → 0 | = | 7 → 7 | 7.1 → 7.3 | 0 → 0 |
| recolor-multi | 0 → 0 | = | 7 → 7 | 7.1 → 7.1 | 0 → 0 |
| recolor-single | 0 → 0 | = | 7 → 7 | 7 → 7.2 | 0 → 0 |
| column-flag | 0 → 0 | = | 7 → 7.1 | 13.8 → 13.9 | 0 → 0 |
| highlight-toggle | 0 → 0 | = | 7 → 7 | 27.8 → 20.9 | 0 → 0 |
| delete-columns | 0 → 0 | = | 7.1 → 7 | 14 → 21 | 0 → 0 |

## 200 tables · 8 columns · full

Load+mount: 710ms → 518ms (-27%)

| scenario | blocking ms | Δ | frame p95 | worst frame | drops |
| --- | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 → 0 | = | 13.8 → 13.9 | 34.8 → 34.8 | 2 → 1 |
| zoom-links-on | 0 → 0 | = | 13.9 → 13.9 | 55.8 → 20.9 | 1 → 0 |
| drag-single | 0 → 0 | = | 7 → 7 | 20.9 → 20.9 | 0 → 0 |
| select-multi | 0 → 0 | = | 7 → 7 | 14 → 7.1 | 0 → 0 |
| drag-multi | 0 → 0 | = | 7.1 → 7 | 20.9 → 7.1 | 0 → 0 |
| recolor-multi | 0 → 0 | = | 7 → 7.1 | 21.1 → 13.8 | 0 → 0 |
| recolor-single | 0 → 0 | = | 7 → 7 | 13.9 → 7.1 | 0 → 0 |
| column-flag | 0 → 0 | = | 7 → 7.1 | 41.8 → 34.8 | 1 → 1 |
| highlight-toggle | 0 → 0 | = | 7 → 7.1 | 48.7 → 41.8 | 1 → 1 |
| delete-columns | 0 → 0 | = | 7 → 7 | 34.7 → 34.8 | 1 → 1 |

## 200 tables · 8 columns · standard

Load+mount: 717ms → 483ms (-33%)

| scenario | blocking ms | Δ | frame p95 | worst frame | drops |
| --- | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 → 0 | = | 7.1 → 13.9 | 34.8 → 27.8 | 3 → 0 |
| zoom-links-on | 0 → 0 | = | 13.9 → 13.9 | 21 → 27.8 | 0 → 0 |
| drag-single | 0 → 0 | = | 7.1 → 7 | 41.7 → 27.8 | 1 → 0 |
| select-multi | 0 → 0 | = | 7 → 7.1 | 13.9 → 7.3 | 0 → 0 |
| drag-multi | 0 → 0 | = | 7.1 → 7.1 | 48.7 → 13.8 | 1 → 0 |
| recolor-multi | 0 → 0 | = | 7.1 → 7 | 14 → 7.1 | 0 → 0 |
| recolor-single | 0 → 0 | = | 7.1 → 7 | 7.1 → 7.1 | 0 → 0 |
| column-flag | 0 → 0 | = | 7 → 7 | 41.8 → 7.1 | 1 → 0 |
| highlight-toggle | 0 → 0 | = | 7 → 7.1 | 41.8 → 41.7 | 1 → 1 |
| delete-columns | 0 → 0 | = | 7.1 → 7.1 | 27.8 → 27.7 | 0 → 0 |

## 200 tables · 8 columns · compact

Load+mount: 698ms → 485ms (-31%)

| scenario | blocking ms | Δ | frame p95 | worst frame | drops |
| --- | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 → 0 | = | 13.8 → 13.8 | 41.7 → 34.7 | 3 → 1 |
| zoom-links-on | 0 → 0 | = | 13.9 → 13.9 | 20.8 → 20.9 | 0 → 0 |
| drag-single | 0 → 0 | = | 7.1 → 7.1 | 27.7 → 27.9 | 0 → 0 |
| select-multi | 0 → 0 | = | 7 → 7 | 14 → 7.2 | 0 → 0 |
| drag-multi | 0 → 0 | = | 7.1 → 7 | 27.8 → 13.9 | 0 → 0 |
| recolor-multi | 0 → 0 | = | 7 → 7.1 | 13.9 → 7.2 | 0 → 0 |
| recolor-single | 0 → 0 | = | 7 → 7 | 13.9 → 7.1 | 0 → 0 |
| column-flag | 0 → 0 | = | 7 → 7 | 34.7 → 8.4 | 1 → 0 |
| highlight-toggle | 0 → 0 | = | 7.1 → 7 | 48.8 → 41.7 | 1 → 1 |
| delete-columns | 0 → 0 | = | 7 → 7.1 | 34.7 → 34.9 | 1 → 1 |

## 500 tables · 8 columns · full

Load+mount: 1515ms → 1019ms (-33%)

| scenario | blocking ms | Δ | frame p95 | worst frame | drops |
| --- | ---: | ---: | ---: | ---: | ---: |
| zoom | 113 → 15 | -87% | 27.8 → 21 | 76.5 → 55.7 | 10 → 10 |
| zoom-links-on | 4 → 40 | +900% | 41.7 → 27.8 | 55.7 → 83.3 | 16 → 8 |
| drag-single | 29 → 0 | -100% | 27.9 → 7 | 104.3 → 48.6 | 8 → 1 |
| select-multi | 0 → 0 | = | 13.9 → 7 | 41.7 → 13.9 | 3 → 0 |
| drag-multi | 15 → 0 | -100% | 27.8 → 7.1 | 83.5 → 27.9 | 2 → 0 |
| recolor-multi | 0 → 0 | = | 7 → 7 | 41.7 → 27.8 | 1 → 0 |
| recolor-single | 0 → 0 | = | 7.1 → 7.1 | 48.7 → 27.7 | 1 → 0 |
| column-flag | 31 → 11 | -65% | 7.1 → 7 | 90.4 → 62.5 | 1 → 1 |
| highlight-toggle | 70 → 40 | -43% | 13.9 → 7 | 118.2 → 90.3 | 2 → 2 |
| delete-columns | 19 → 25 | +32% | 7.1 → 7 | 76.5 → 69.5 | 1 → 1 |

## 500 tables · 8 columns · standard

Load+mount: 1448ms → 839ms (-42%)

| scenario | blocking ms | Δ | frame p95 | worst frame | drops |
| --- | ---: | ---: | ---: | ---: | ---: |
| zoom | 57 → 3 | -95% | 21 → 14 | 62.6 → 48.7 | 10 → 4 |
| zoom-links-on | 0 → 0 | = | 41.7 → 34.7 | 48.8 → 48.7 | 16 → 13 |
| drag-single | 22 → 0 | -100% | 20.9 → 7 | 90.3 → 48.6 | 2 → 1 |
| select-multi | 0 → 0 | = | 21 → 7 | 41.7 → 14 | 6 → 0 |
| drag-multi | 26 → 0 | -100% | 27.8 → 7 | 111.3 → 27.7 | 3 → 0 |
| recolor-multi | 0 → 0 | = | 7 → 7 | 41.8 → 41.5 | 1 → 1 |
| recolor-single | 0 → 0 | = | 7.1 → 7.1 | 41.8 → 20.8 | 1 → 0 |
| column-flag | 25 → 17 | -32% | 7 → 7 | 83.4 → 62.5 | 1 → 1 |
| highlight-toggle | 78 → 35 | -55% | 13.9 → 7.1 | 125.1 → 83.4 | 2 → 2 |
| delete-columns | 16 → 22 | +38% | 7 → 7 | 76.5 → 69.5 | 1 → 1 |

## 500 tables · 8 columns · compact

Load+mount: 1470ms → 808ms (-45%)

| scenario | blocking ms | Δ | frame p95 | worst frame | drops |
| --- | ---: | ---: | ---: | ---: | ---: |
| zoom | 53 → 0 | -100% | 21 → 13.9 | 69.6 → 48.7 | 10 → 4 |
| zoom-links-on | 8 → 0 | -100% | 41.7 → 27.9 | 55.7 → 48.7 | 16 → 11 |
| drag-single | 20 → 3 | -85% | 20.9 → 7 | 90.3 → 48.6 | 2 → 1 |
| select-multi | 0 → 0 | = | 14 → 7 | 34.8 → 13.9 | 1 → 0 |
| drag-multi | 22 → 0 | -100% | 27.8 → 7 | 97.3 → 20.9 | 5 → 0 |
| recolor-multi | 0 → 0 | = | 7 → 7 | 41.7 → 34.7 | 1 → 1 |
| recolor-single | 0 → 0 | = | 7.1 → 7 | 41.7 → 27.9 | 1 → 0 |
| column-flag | 24 → 18 | -25% | 7.1 → 7 | 83.5 → 7.1 | 1 → 0 |
| highlight-toggle | 55 → 36 | -35% | 14 → 13.9 | 104.2 → 90.4 | 2 → 2 |
| delete-columns | 15 → 19 | +27% | 7 → 7.1 | 76.5 → 9.8 | 1 → 0 |

## 100 tables · 4 columns · standard

Load+mount: 689ms → 524ms (-24%)

| scenario | blocking ms | Δ | frame p95 | worst frame | drops |
| --- | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 → 0 | = | 13.8 → 13.8 | 34.8 → 27.8 | 2 → 0 |
| zoom-links-on | 0 → 0 | = | 14 → 20.9 | 48.8 → 34.7 | 5 → 1 |
| drag-single | 0 → 0 | = | 7 → 7 | 13.9 → 7.1 | 0 → 0 |
| select-multi | 0 → 0 | = | 7.1 → 7 | 34.8 → 14 | 1 → 0 |
| drag-multi | 0 → 0 | = | 7 → 7 | 20.9 → 7.1 | 0 → 0 |
| recolor-multi | 0 → 0 | = | 7.1 → 7 | 13.9 → 7.1 | 0 → 0 |
| recolor-single | 0 → 0 | = | 7 → 7 | 7.1 → 7.1 | 0 → 0 |
| column-flag | 0 → 0 | = | 7 → 7 | 27.8 → 20.9 | 0 → 0 |
| highlight-toggle | 0 → 0 | = | 7 → 7 | 34.8 → 20.9 | 1 → 0 |
| delete-columns | 0 → 0 | = | 7 → 7 | 20.8 → 20.8 | 0 → 0 |

## 100 tables · 16 columns · standard

Load+mount: 712ms → 475ms (-33%)

| scenario | blocking ms | Δ | frame p95 | worst frame | drops |
| --- | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 → 0 | = | 7.1 → 13.9 | 27.8 → 34.7 | 0 → 1 |
| zoom-links-on | 0 → 0 | = | 14 → 20.8 | 34.8 → 34.6 | 2 → 1 |
| drag-single | 0 → 0 | = | 7 → 7 | 13.9 → 13.8 | 0 → 0 |
| select-multi | 0 → 0 | = | 7.1 → 7 | 21 → 13.9 | 0 → 0 |
| drag-multi | 0 → 0 | = | 7 → 7 | 20.9 → 13.9 | 0 → 0 |
| recolor-multi | 0 → 0 | = | 7.1 → 7 | 14 → 7.2 | 0 → 0 |
| recolor-single | 0 → 0 | = | 7 → 7 | 7.1 → 7.1 | 0 → 0 |
| column-flag | 0 → 0 | = | 7.1 → 7 | 41.6 → 34.9 | 1 → 1 |
| highlight-toggle | 0 → 0 | = | 7 → 7 | 27.8 → 27.9 | 0 → 0 |
| delete-columns | 0 → 0 | = | 7 → 7.1 | 27.8 → 20.9 | 0 → 0 |

## 100 tables · 32 columns · standard

Load+mount: 702ms → 511ms (-27%)

| scenario | blocking ms | Δ | frame p95 | worst frame | drops |
| --- | ---: | ---: | ---: | ---: | ---: |
| zoom | 0 → 0 | = | 7.1 → 13.9 | 34.7 → 27.8 | 2 → 0 |
| zoom-links-on | 0 → 0 | = | 14 → 20.8 | 41.8 → 27.9 | 3 → 0 |
| drag-single | 0 → 0 | = | 7 → 7 | 13.9 → 14 | 0 → 0 |
| select-multi | 0 → 0 | = | 7.1 → 7 | 27.8 → 14 | 0 → 0 |
| drag-multi | 0 → 0 | = | 7 → 7 | 20.9 → 7.1 | 0 → 0 |
| recolor-multi | 0 → 0 | = | 7 → 7 | 14 → 7.1 | 0 → 0 |
| recolor-single | 0 → 0 | = | 7.1 → 7 | 7.1 → 7.1 | 0 → 0 |
| column-flag | 0 → 0 | = | 7 → 7 | 22.4 → 48.6 | 0 → 1 |
| highlight-toggle | 0 → 0 | = | 7 → 7.1 | 34.8 → 20.9 | 1 → 0 |
| delete-columns | 0 → 0 | = | 7.1 → 7 | 27.8 → 8.4 | 0 → 0 |

## Totals

- Blocking time (sum over all scenarios): 784ms → 331ms (-58%)
- Load+mount (sum over all configs): 14487ms → 9318ms (-36%)
- Dropped frames (sum): 197 → 118
