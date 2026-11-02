- Add a provider-neutral observed-traffic source contract behind Street Traffic.
  External producers can supply bounded road-segment, approach or intersection
  observations with timestamps, coarse counts/rates, movements, quality and
  provenance. The contract normalizes malformed siblings fail-soft, distinguishes
  fresh/partial/stale/error states (including future-dated evidence beyond
  60 seconds of clock skew), caps payload size, preserves cancellation and
  keeps observed-source health separate from TomTom flow and simulated traffic.
  With no observed source configured the shipped Traffic behavior is unchanged
  (kvnloo, #844, for #830).
