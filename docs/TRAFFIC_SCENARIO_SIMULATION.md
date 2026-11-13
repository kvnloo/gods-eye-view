# Traffic scenarios: SUMO statistics → comparable *simulation* receipts

This optional offline adapter does **not** control traffic lights or change the GEV
traffic layer. It lets a SUMO experiment produce machine-readable, source-hashed
run receipts for the pure comparator in `src/data/trafficScenarioComparison.js`.
No SUMO dependency is bundled into GEV. Nothing here is observed vehicle flow.

## Inputs and fairness policy

Follow the official SUMO [statistics](https://sumo.dlr.de/docs/Simulation/Output/StatisticOutput.html)
and [tripinfo](https://sumo.dlr.de/docs/Simulation/Output/TripInfo.html)
documentation. A fixed-end-time experiment can falsely favor a congested
controller when only *completed* trips are reported: the remaining vehicles
are absent from default tripinfo averages.

Run each identical network/demand/seed/time window with an alternative signal
plan and enable both unfinished-trip inclusion and summary statistics:

```sh
sumo -c ./your-corridor.sumocfg \
  --tripinfo-output ./baseline.tripinfo.xml \
  --tripinfo-output.write-unfinished true \
  --duration-log.statistics true \
  --statistic-output ./baseline.statistics.xml
```

Produce candidate outputs with the *same road network*, demand/route file,
random seed, simulation time window and evaluation protocol. The signal plan
(and its ID) is what changes. The `--statistic-output` file alone is sufficient
for the adapter; raw tripinfo never enters GEV. Use source-licensed OSM geometry
and independently validate the road/demand inputs before making public claims.

Provide separate `baseline.meta.json` and `candidate.meta.json` sidecars:

```json
{
  "runId": "corridor-seed7-fixed",
  "planRevision": "fixed-v1",
  "sumoOptions": {
    "tripinfoOutputWriteUnfinished": true,
    "durationLogStatistics": true
  },
  "context": {
    "networkRevision": "sha256:your-pinned-road-graph-input",
    "demandRevision": "sha256:your-pinned-demand-input",
    "inputEvidenceRevision": "synthetic-or-licensed-demand-revision",
    "simulatorId": "sumo",
    "simulatorVersion": "your-exact-sumo-version",
    "evaluationRevision": "sumo-stats-complete-v1",
    "randomSeed": 7,
    "windowStartMs": 0,
    "windowEndMs": 600000
  }
}
```

For `candidate.meta.json`, only change `runId` and `planRevision` when all
input fields match. `windowStartMs`/`windowEndMs` must match SUMO's
`<performance begin/end>` attributes (simulation seconds converted to ms).
These metadata fields and SUMO flags are **operator attestations**: the summary
XML cannot cryptographically prove the seed, controller, OSM geometry or flags.
Do not reuse the same revision string for different input bytes.

From the repository root:

```sh
python3 scripts/traffic-scenarios/sumo-statistics-receipt.py \
  --metadata baseline.meta.json --statistics baseline.statistics.xml \
  --output baseline.receipt.json
python3 scripts/traffic-scenarios/sumo-statistics-receipt.py \
  --metadata candidate.meta.json --statistics candidate.statistics.xml \
  --output candidate.receipt.json
node scripts/traffic-scenarios/compare-sumo-receipts.mjs \
  baseline.receipt.json candidate.receipt.json
```

The comparator returns `status: comparable` with **neutral signed deltas** only
when both run receipts have equal context and complete vehicle coverage;
otherwise `unknown`/`incomparable` and exit code 2. Completeness requires
loaded = inserted = trip-stat count > 0, zero running/waiting vehicles, zero
simulated teleports, and all required metrics. Empty or censored runs preserve
reason codes but emit no performance metrics. A measured `0` is not missing.

Supported v0 statistics: average vehicle time loss, average vehicle trip
duration, total vehicle travel time, and total vehicle departure delay. Those
are simulated *vehicle* statistics—not person-delay, p95 queues, pedestrian
safety, emergency-response time, or observed real-world improvements. Raw
vehicle identities and footage are not imported or retained.

## Tests and next gate

```sh
python3 scripts/traffic-scenarios/test-sumo-statistics-receipt.py -v
node --test src/data/trafficScenarioComparison.test.mjs \
  src/data/trafficScenarioSumo.test.mjs
```

Fixtures in the test code are **synthetic XML**, not actual SUMO runs. Before
upstream promotion: supported Node 24/26, formatting, boundary, build, browser
regression, an installed SUMO version with identical scenarios, and independent
product/maintainer demand must be verified. No GEV-generated recommendation
should be applied to live signals without separate agency review and safety
engineering.
