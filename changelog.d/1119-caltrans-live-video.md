- Add opt-in live video for Caltrans cameras. With `CCTV_CALTRANS_VIDEO=1`, a
  camera whose district feed lists a live stream plays it through the bounded
  HLS relay, with a pinned still as fallback when available. An HLS-only row
  appears only with opt-in; other values preserve stills-only registration. Only playlists on
  Caltrans's own streaming host (`wzmedia.dot.ca.gov/D<n>/<name>.stream/playlist.m3u8`)
  are registered, so a catalog field cannot point the relay anywhere else
  (agarity, #1119).
