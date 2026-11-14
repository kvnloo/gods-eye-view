- Preserve the overview when selecting map objects, show live details in the
  right rail, and require double-click or Focus for camera navigation. Restore
  last view returns to the exact camera pose before the latest deliberate focus.
  Unselected AIS vessels keep icons without full-detail cards; details-panel
  buttons no longer click through to the globe (dylanmaniatakes, #1534).
- Clear stale OBJECT DETAILS when the selected context is removed, even while
  its layer still exposes last-known telemetry (follow-up by kvnloo to
  dylanmaniatakes, #1534).
