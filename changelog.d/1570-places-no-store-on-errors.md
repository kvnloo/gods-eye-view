- Stop the browser caching a refused Google Places or Geocoding answer. The
  proxies sent `private, max-age=300` on a 403 and on a geocode
  `REQUEST_DENIED` or `OVER_QUERY_LIMIT`, so a fixed key kept failing for five
  minutes; refusals are now `no-store` (Rudy Celekli, @rudycelekli, #1570).
- Treat unreadable Google Places HTTP 200 responses as uncached 502 errors,
  not five-minute empty successes (gekh report; Rudy Celekli, #1570).
