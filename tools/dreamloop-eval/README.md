# dreamloop-eval

This tool scores app renders for the theme dream loop. Each capture is scored against its own view's target.
TRAIN and HELD-OUT are reported separately (median + IQR, with coverage), along with a repeatability floor, the
visible pixel change against the parent, and blinded two-seat A/B packets.

- `CONTRACT.md`: the capture manifest and split file the scorer reads (written by the capture harness).
- `METRICS.md`: normalization, metric direction, missing-class handling, global score, noise floor and gates,
  all fixed before experiments.

## Setup

Python 3.11+ with numpy and opencv-python. Perceptual metrics also need torch, `lpips` and `piq` 0.8.0. On Studio, the
GEV-G venv has torch, lpips and OpenCV, and `apploop/pylib` has piq:

```sh
cd tools/dreamloop-eval
PY=/Users/kvn/workspace/sandbox/tek/work/gev-factory/gevg/.venv/bin/python
export PYTHONPATH=$PWD:/Users/kvn/workspace/sandbox/tek/work/gev-factory/apploop/pylib
```

## Commands

```sh
M="--manifest captures.jsonl --split split.json"
$PY -m dreamloop_eval score   $M --build <build>[:<run>] --out scores/<name>.json      # fails if LPIPS/DISTS can't load
$PY -m dreamloop_eval noise   --scores a.json b.json c.json --out noise.json          # >= 3 recaptures, one build
$PY -m dreamloop_eval change  $M --parent <build>[:<run>] --candidate <build>[:<run>] --out change.json
$PY -m dreamloop_eval packets $M --parent ... --candidate ... --seed <round-seed> --out ab/<round>
$PY -m dreamloop_eval verdict --packet ab/<round> --seat seat1 --item <id> --winner X --judge <name>
$PY -m dreamloop_eval tally   --packet ab/<round>                                     # -> ab/<round>/result.json
$PY -m dreamloop_eval report  --scores cand.json --parent parent.json --noise noise.json \
                              --change change.json --judges ab/<round>/result.json --out report.md
```

The scorer does not know where its data comes from. Which captures and targets may be scored is the loop's decision
(see `gev-factory/gevg/TERMS.md`; until the owner rules, only open data is scored).

If a build has more than one run, name the run (`build:run`). Runs are never merged.
`import-apploop` writes a contract manifest for renders made by the older `gev-factory/apploop` harness.

## Tests

```sh
PYTHONPATH=$PWD:$PWD/tests:$PYTHONPATH $PY -m unittest discover -s tests -v
```

The tests cover: cross-view target, mask and camera pairing; panel leakage; hash and size checks; the
hand-checked aggregation fixtures in `tests/fixtures/agg`; noise-floor rules; visible-change tolerance; packet
determinism, side swap and leakage audit; tally gating on missing verdicts and ties; and explicit failure when
LPIPS/DISTS are unavailable. The real-LPIPS/DISTS test is skipped if torch is not importable, and the skip shows in
the output.
