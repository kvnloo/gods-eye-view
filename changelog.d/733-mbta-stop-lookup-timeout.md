- Preserve MBTA service alerts when optional stop-position lookups stall: limit
  stop enrichment to two seconds and serve decoded alerts without markers
  instead of returning 504 (kvnloo; builds on PNederhoed's #733; thanks to
  quanticsoul4772 for the regression report).
