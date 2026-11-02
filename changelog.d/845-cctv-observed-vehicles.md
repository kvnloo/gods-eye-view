- Add an off-by-default **VEHICLES EXP** bridge from the active CCTV feed to
  Street Traffic. It reuses already-fetched pixels for a bounded 160×90 local
  frame-difference pass, casts each moving candidate's bottom-centre pixel
  through the calibrated camera pose, rejects implausible rays, snaps only to
  nearby loaded OSM roads, and renders cyan **CCTV observed** contacts with
  source, confidence and age. Contacts are set-replaced, clear on camera/layer
  changes and expire after 12 seconds; there is no cross-frame/cross-camera
  identity, face/plate recognition, frame upload or observation archive. The
  motion-only v0 does not detect stationary vehicles, and its coarse vehicle
  labels are geometry heuristics rather than semantic classification
  (tracked in `kvnloo/gods-eye-view#89`). A local contrast check filters
  clearly vacated synthetic motion footprints; uncertain frames remain
  heuristic and unverified (kvnloo, #845).
