- Add the opt-in Auckland NZTA CCTV pack (`CCTV_AUCKLAND_ENABLED=1`),
  now reading the documented Traffic and Travel REST API instead of the
  Journeys map-data-cache site asset. Filter `response.camera[]` to
  Auckland region 2, exclude offline and under-maintenance cameras, and
  synthesize JPEG frame URLs from validated camera ids. The nearest 120
  cameras share the existing catalog ceiling; the pack cap remains configurable.
  Document API terms, required attribution, and the operator permission needed
  for projecting frames into 3D. (mvanhorn, #1126; review by samehkhamis)
