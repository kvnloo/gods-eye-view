# SUMO corridor against published counts (GEH)

This experiment scores the corridor simulation against published traffic
counts. It is **hypothetical simulation**. It says how close a model is to one
count day. It does not say that any signal plan is better in the real world.

It continues downstream #182 and stacks on the real-SUMO corridor proof. The
synthetic corridor of `TRAFFIC_SCENARIO_CORRIDOR.md` is step S0 here.

## Count source

- Corridor: SR-90 / Imperial Highway, Rose Drive to Yorba Linda Boulevard,
  Orange County, California. Five signalised intersections.
- Counts: City of Yorba Linda, _Housing Element & General Plan Update Traffic
  Analysis_ (Urban Crossroads, 26 May 2022), EIR Appendix G, State
  Clearinghouse number 2022040574. Appendix 4.1 holds 15-minute turning counts
  by Counts Unlimited, Inc. for Tuesday 15 March 2022, 07:00-09:00 and
  16:00-18:00.
- Terms: the file is a public record on CEQAnet and needs no login. CEQAnet's
  Conditions of Use ask for the owner's permission before third-party material
  is reused. **So no value from the study is stored in this repository.** The
  fixture holds the citation, the URL, the SHA-256 of the PDF and the SHA-256
  of the parsed result. The runner fetches the PDF, checks both hashes and
  stops if either differs. Observed counts are never edited.
- Other sources checked and not used as observed counts: Caltrans PeMS (login),
  FHWA TMAS (no station on SR-90), Caltrans Traffic Census (annual averages and
  one estimated peak hour; used as a demand source in step S2, Creative
  Commons Attribution).

## Metric

GEH = sqrt(2 (M - C)^2 / (M + C)) for a simulated hourly volume M and a counted
hourly volume C. A count-hour passes when GEH < 5. The metric is the share of
count-hours that pass. The stop line is 85%.

The scored set is fixed for every step: the Imperial Highway approach volume
(left + through + right) for each of four clock hours at the eight approach
points inside the model. That is 32 count-hours. The two approaches that feed
the model from outside and all cross-street approaches are never scored. A
missing simulated value fails; it is never read as 0.

Each step runs seeds 7, 19 and 41 and both windows with 15 minutes of warm-up.

## Steps

Each step changes one input. Each input is sourced or marked `ASSUMED` in
`scripts/traffic-scenarios/observed/sr90-imperial-yorba-linda-20220315.json`.
No value is fitted to the counts.

| Step | The one change | Source of the change |
| --- | --- | --- |
| S0 | None. The stack's network, demand rates and fixed-time plan | - |
| S1 | Network: measured spacing and stop-line lane groups | OpenStreetMap; the study's worksheets |
| S2 | Mainline entry demand: half of the two-way peak-hour volume | Caltrans 2022 Traffic Volumes |
| S3 | Mainline entry demand: 15-minute volumes that left the two boundary intersections | the study (unscored movements) |
| S4 | Signal control type: the stack's gap-actuated plan, timings unchanged | the study's sheet for the adjacent Caltrans signal (type only) |
| S5 | Turning shares at the three signals, per 15 minutes | the study |
| S6 | Cross-street entry demand, per 15 minutes | the study (unscored approaches) |
| S7 | Mainline speed: posted limit of each link (not kept) | OpenStreetMap |

Results are in the pull request that adds this file and in the run summaries.
Read them with these limits in mind:

- **S2 and S3 agree with the counts for the wrong reason.** The fixed-time plan
  gives the mainline 17 s of green in 60 s. It holds back traffic to a volume
  that happens to be near several counts. The summary shows this without any
  count: `vehiclesNotInsertedAtEnd` is above zero, and `flowArithmeticPassed`
  is far below the simulated score.
- **From S5 on, the split of a scored approach is an input.** Its volume is
  not. The score then mostly tests two things: that flow is conserved between
  counted intersections, and that the model can serve the demand.
- **The remaining misses are in the data, not in the simulator.**
  `flowArithmeticPassed` is the score of plain flow arithmetic on the same
  inputs, with no simulator and no travel time. When it misses a count-hour, no
  signal, lane or speed setting can repair it. The section has streets and
  driveways that the model does not have (Los Angeles Street, Valley View
  Avenue, Casa Loma Avenue, Eureka Avenue), and no count is published for them.
- The signal timings (minimum 8 s, maximum 50 s), the 50/50 directional split
  in S2 and the lane count along each link are `ASSUMED`.
- One weekday, two peak windows, one section. Nothing here is validated for
  another day, hour or place.

## Reproduce

Needs Eclipse SUMO 1.24.0 (`sumo`, `netconvert`), Python 3.12, `pdftotext`
(poppler) and network access for the one PDF download.

```sh
python3 scripts/traffic-scenarios/test-observed-counts.py -v
python3 scripts/traffic-scenarios/run-observed-corridor.py --step S6 \
  --output /tmp/gev-observed-S6 --cache /tmp/gev-observed-cache
```

The output directory must not exist. `summary.json` holds the share per seed,
the GEH bands and the two diagnostics. It holds no count. `--detail FILE`
writes the per count-hour table with observed values; keep that file out of
git and out of any public place. The demand files in the output directory of
S3 and later also carry counted volumes; do not publish them.

The unit tests use invented numbers only and need no simulator and no network.
