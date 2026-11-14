- Submarine cables draw from a few batched primitives instead of thousands of
  entities. Switching the layer off and back on, and zooming with it on, no
  longer stall the page, and it holds about 900 MB less memory. Double-click
  no longer starts Cesium's entity tracking on a cable (mazy1998, #1722).
- Camera sweeps preserve the 48-per-frame landing clamp budget even when
  moveEnd arrives during staged reveal (mazy1998, #1722).
