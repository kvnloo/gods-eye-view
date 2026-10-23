- The policy-only voice presentation resolver now falls back to idle for
  unknown controller session states and requires literal boolean activity
  flags, while retaining accepted Space barge-in and audible-output precedence.
  The HUD still does not consume this projection (kvnloo, #265; review:
  quanticsoul4772 and asturksever).
