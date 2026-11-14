- Restore the optional FlightAware AeroAPI history fallback in the civil flights
  layer, preserving the primary live feed and forwarding the tracked aircraft's
  callsign/registration for keyed history resolution; repair the live-source
  test entry to validate this path (gietabhi10, #625).
