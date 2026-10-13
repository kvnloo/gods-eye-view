# Real SUMO execution, synthetic corridor

This is the next experiment for downstream #182, stacked on #199 and #186.
It invokes installed SUMO binaries; it never substitutes fabricated output.
It does **not** represent SR-90, a real city, validated demand or field results.

## Reproduce

Install Eclipse SUMO **1.24.0** (`python3 -m pip install eclipse-sumo==1.24.0`)
and GEV-supported Node **24.14.x** or **26.x**. Ensure both `sumo` and
`netconvert` are on PATH. From the repository root:

```sh
python3 scripts/traffic-scenarios/test-sumo-corridor.py -v
python3 scripts/traffic-scenarios/run-sumo-corridor.py --output /tmp/gev-sumo-evidence
```

The output directory must not already exist. Simulator version, exact inputs,
commands, logs, per-run metadata, source-hashed receipts, comparisons and
summary JSON/Markdown are preserved. Do not commit local paths or live data
into the main application.

## Fixed experiment (not optimized after observing results)

- One synthetic 1.2 km straight-only corridor with three signals, 300 m apart,
  and bidirectional cross streets at each signal. One lane per direction.
- Identical generated network bytes for both treatments. Additional signal
  programs change timings, not road geometry or SUMO-generated clearances.
- Baseline: generated fixed-time 60-second cycles. Candidate: SUMO's built-in
  gap-actuated controller, green minimum 8 seconds, maximum 50 seconds.
- Explicit synthetic Poisson departures for ten minutes: eastbound 600 veh/h,
  westbound 300 veh/h, and each of six cross-street entries 120 veh/h.
- Paired seeds **7, 19 and 41**, the same demand-file bytes per pair; simulate
  thirty minutes to allow the loaded cohort to finish. Report all pairs,
  including regressions; do not select the best seed or invent a winner.
- Loaded/inserted/completed counts must account for every authored vehicle.
  Unfinished/waiting vehicles, teleports, collisions, emergency stops or missing
  safety evidence withhold the affected comparison.
- Each paired run requests SUMO `SaveTLSSwitchStates` output (a separate
  read-only additional-file). All three signals **must report the expected
  active program**: `experiment-fixed` or `experiment-actuated`. Wrong,
  missing or mixed programs withhold comparison even if vehicle delays look good.
  Each controller must report multiple distinct phases, ordered finite times,
  an initial event in the first 5% of the 30-minute run, and an event within
  its final 5%. One event per controller is **not** full-run evidence.
  The raw `*.tls-switches.xml` files, hashes and per-controller first/last
  event times remain in the artifacts; the signal-plan bytes stay unchanged.
- An additional real run ends after 30 seconds: its partial receipt must
  contain no performance metrics. This is a negative control, not a fourth
  controller comparison.

The smoke gate passes when the executions and completeness checks succeed;
it does **not** require actuated signals to outperform the fixed baseline.
Vehicle time loss is not person-delay, pedestrian safety, emergency response,
network-wide optimality or an empirically validated traffic improvement.

## Fork-only execution

`.github/workflows/traffic-sumo-corridor.yml` is limited to pushes on the named
experiment branch and `kvnloo/gods-eye-view`. It uses read-only repository
permissions, no credentials in checkout, a bounded job timeout, and 14-day
artifacts. No autonomous merges, upstream comments or signal writes.
An empty workflow-run listing means **unexecuted/unverified**, never green.

Before promotion: inspect actual simulator logs and results, repair source
contracts exposed by the run, validate upstream product demand, reconcile
existing reviews and satisfy the factory origin gate. Full application CI,
build and browser QA remain separate from this focused offline experiment.

## Credit and sources

Kevin Rajan proposed the GEV city-infrastructure direction. Reuse the GEV
maintainers' traffic/CCTV ownership and downstream #186/#199; this does not
replace their architecture. SUMO and its controller are from DLR and the
Eclipse SUMO contributors; no novel control algorithm is claimed.

- SUMO traffic lights and additional programs:
  https://sumo.dlr.de/docs/Simulation/Traffic_Lights.html
- SUMO statistical outputs and incomplete-trip caveats:
  https://sumo.dlr.de/docs/Simulation/Output/StatisticOutput.html
- Pinned simulator release (not a claim of latest version):
  https://pypi.org/project/eclipse-sumo/1.24.0/

- SUMO documented traffic-light switch-state format and `programID` field:
  https://sumo.dlr.de/docs/Simulation/Output/Traffic_Lights.html
