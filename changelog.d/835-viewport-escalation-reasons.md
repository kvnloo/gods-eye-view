- Voice viewport escalation now emits compact reason-code diagnostics without
  recording tool payloads or image contents. The policy still prefers
  structured entity identity, preserves the live point-and-ask crop added in
  #837, and does not add image requests, change image retention or
  automatically widen visual scope (kvnloo, #835; reviewed by asturksever and
  quanticsoul4772).
