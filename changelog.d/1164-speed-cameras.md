- Add a Speed Cameras layer mapping community-mapped `highway=speed_camera`
  locations worldwide through the shared Overpass proxy, with the inline OSM
  credit, a not-configured status when no Overpass upstream is set, and
  `get_speed_cameras` voice queries (DrivenIdeaLab, #1164).
- Discard an older Overpass status response when a fresh enable has already
  re-probed the server, so stale "not configured" results cannot hide cameras
  after configuration changes (follow-up to DrivenIdeaLab, #1164).
