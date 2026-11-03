- Cancel superseded Recent Imagery thumbnail fetches when focus, visible range,
  pins or preview change; known-good availability metadata is kept and each
  aborted in-flight request is counted once (kvnloo, #881; independent
  cancellation review: quanticsoul4772).
