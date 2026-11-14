# GOES FDCF day/night provenance (#497)

- Keyless GOES detections now leave `daynight` unknown instead of applying the granule's one scene-wide solar-zenith angle to individual fire pixels. FIRMS retains its per-record day/night.
- The real HDF5 fixture models the scalar metadata and regression tests assert unknown day/night through decoding and the API.
- Original keyless GOES contribution: beneduzi. Scene-wide angle finding: bilawalsidhu.
