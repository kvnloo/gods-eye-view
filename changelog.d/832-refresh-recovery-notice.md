- Show one layer-named refresh recovery notice after a failed refresh accepts
  newer healthy data. Preserve error and retry priority, acquisition notices,
  and finite dwell; do not replay hidden or repeated recoveries. Integrates
  Kevin Rajan's attention policy from #832 with its first production UI caller.
  Thanks to quanticsoul4772 for the missing-caller and unknown-freshness reviews,
  and samehkhamis for requiring a complete feature rather than a policy slice
  (@kvnloo, follow-up to #832).
