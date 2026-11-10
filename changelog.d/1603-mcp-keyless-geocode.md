- MCP tools resolve place names through the keyless Photon geocoder when the
  server has no geocoder configured. Transient Photon failures are retried,
  not cached as unmatched places (asturksever, #1603).
