- Active Fires uses conditional ETags to avoid transferring and re-parsing
  an unchanged worldwide snapshot on every 10-minute poll. On a 304 it expires
  detections against the proxy's trailing-24-hour clock rather than the
  browser clock, avoiding stale or prematurely removed detections when device
  time differs. Tool callers still receive full snapshots (Darn0, with
  quanticsoul4772's clock-skew review and kvnloo's follow-up, #965).
