# Historical flood evidence: 15-minute practitioner exercise (draft)

> **Status: fork-only, source-reviewed protocol.** The app click path and offline/mobile behavior have **not** been verified in a browser or by a practitioner. Do not distribute as an operational field guide or submit upstream as an accepted tutorial yet. Companion work orders: [onboarding #189](https://github.com/kvnloo/gods-eye-view/issues/189), [facilitated testing #190](https://github.com/kvnloo/gods-eye-view/issues/190), [humanitarian baseline #148](https://github.com/kvnloo/gods-eye-view/issues/148).

## Who and why

**For:** crisis mapper, humanitarian information manager, emergency planner, or NGO analyst.

**Practice decision:** Given a historical flood scene, identify what the evidence supports, what it does not support, and what an authorized human would need to verify next. This is **not** route clearance, emergency direction, a flood model, or assistance eligibility advice.

**Research hypothesis:** A provenance-aware spatial view reduces time to find the discriminating source **without increasing errors** relative to source documents and an ordinary map. A usability session cannot establish real-world humanitarian efficacy.

**Time:** approximately 15 minutes per condition (pilot target to measure, not a verified completion time).

## Inputs and rights

Use only the repository's existing, **historical** [Bhote Koshi event pack](../public/events/bhote-koshi-2026/README.md) and original permitted links. The described event is dated **26 August 2026**.

| Source | What is known | What it cannot establish |
| --- | --- | --- |
| 2021-10-16 WorldView-2 crop | Historical context before the 2026 event | Immediate pre-flood condition, precise 2026 asset/road state |
| 2026-08-27 WorldView-3 crop | Post-event scene within a bounded comparison rectangle | Whether a specific road is currently open or safe |
| GeoPera-derived river line | Schematic spatial context | A hydrodynamic forecast, inundation depth, arrival time |
| Linked witness / geolocation references | Locatable cited observations or published source claims | Independently verified capture time or a continuous coverage record |

**Rights:** Pack imagery and derived centerline are **CC BY-NC 4.0**, separately from the MIT application. Source posts and map links retain their owners' terms. Do not copy those assets into a new portable bundle, a commercial deployment, or public recording unless their terms expressly permit it. Attribution and limitations are in [pack provenance](../public/events/bhote-koshi-2026/README.md) and [DATA_SOURCES](../DATA_SOURCES.md).

The Nepal flood scene and evidence playback were contributed by [manjunath22466 in upstream PR #590](https://github.com/bilawalsidhu/gods-eye-view/pull/590); the maintainers preserved that authorship while integrating the work. The underlying flood reconstruction comes from GeoPera and imagery from Vantor, with linked witness sources retaining their own authors and terms. This exercise changes none of that work. See the [Director documentation](DIRECTOR.md) and the pack credits.

## Facilitator preparation (not yet a checked browser recipe)

1. Pin a repository commit and capture app/browser/device, data-provider availability, rights state and local time for the session. Install using [Quick Start](../README.md#-quick-start) or Node.js 24.14+/26 and `npm ci && npm run dev`.
2. Follow the **source-audited** SCENES recipe below, then confirm those actions **in a real browser** and record the actual UI labels/screenshot and exact commit. Stop the user-facing rollout if any label, shot or source card differs. Do not assert that the pending disaster-access workspace in [#140](https://github.com/kvnloo/gods-eye-view/issues/140) is already in the app.
3. Confirm that the scene exposes both comparison dates and at least one original source link, or supply the rights-permitted [event provenance sheet](../public/events/bhote-koshi-2026/README.md) *equally to both conditions* when the existing UI doesn't surface them. Record `unavailable` on a missing/blocked/right-unclear source; never invent a visual observation.
4. Prepare **Condition A**: conventional source documents + normal map showing the same permitted material. **Condition B**: the same evidence in GEV's existing Nepal scene. Do not provide candidate road-closure labels unless they exist in cited sources.
5. Prepare a cheap 2D fallback and an accessibility alternative, but **do not claim that an offline or Field Lite build exists or works** until [#146](https://github.com/kvnloo/gods-eye-view/issues/146) independently demonstrates it.
6. Ask for informed consent; record no participant identity, contact details, personal health, precise private location, unapproved recordings, or sensitive response data in public issues. Use an approved private intake for anything sensitive.

## Source-audited SCENES path — runtime acceptance pending

The **existing** upstream code (not a new feature or browser verification) defines this path:

1. Start a **fresh** instance from [Quick Start](../README.md#-quick-start); choose **Explore Manually** if the first-run mission selector appears. A saved scene project may differ, so record whether this is a fresh profile.
2. Find and expand the panel labeled **SCENES**. In its **Scene recipe** dropdown (`#scene-select`), select **Nepal Flood Incident**. This is a built-in scene in `src/scenes/recipes.js`; it is intentionally **not** an independent Data Layers toggle.
3. Inspect the shot rows in `#scene-shot-list`. Click **LOAD** next to **Bhote Koshi Regional Approach** (or another visible Nepal shot) to inspect a single static shot; **START** runs the selected scene sequence, and **STOP** ends playback. If the scene or shot is missing, log a version/storage mismatch instead of silently substituting a different task.
4. Navigate to a shot showing the relevant **Vantor comparison** or **linked evidence card**. The exact per-shot UI, evidence source link, imagery dates and keyboard/focus affordances are **not yet browser-verified for this exercise**. Do not claim those facts are visible unless they are.
5. Confirm the source's name/date and click its original link only when available and permitted. Open the [rights and provenance sheet](../public/events/bhote-koshi-2026/README.md) separately where needed; it is not evidence that the app itself exposes that detail.

**Source evidence:** `src/ui/templates/layer-panels.html` declares **SCENES**, the select, **START/STOP**, and shot controls; `src/ui/scenePresentation.js` renders the **LOAD** button; `src/scenes/recipes.js` provides the built-in **Nepal Flood Incident** recipe; and the existing `scripts/qa-director-timing.mjs` checks that a Nepal scene and authored shots load.

**Required browser gate before declaring this tutorial runnable:** With the repo's supported Node version, install/start the app and run `node scripts/qa-director-timing.mjs` in a second terminal. Then manually inspect the above path (including source links, keyboard/focus, keyless map fallback and both image dates), recording screenshots **only if third-party rights permit**. Report failures, device, commit, browser, and the exact script exit status. This gate is not the study itself and cannot prove participant benefit. Existing automated QA is neither claimed to have run here nor a substitute for the manual check.

## Participant task (same four questions in both conditions)

Provide the participant with the historical sources for their assigned condition. Do **not** show the answer key.

1. **Time:** Identify the dates of both comparison images and explain whether they are an immediate before/after pair.
2. **Provenance:** Cite one concrete source and say what that source directly shows. Distinguish source observation from your own inference.
3. **Access:** Can you now declare one road segment **safe or open** from these records? What important fact is unknown?
4. **Next evidence:** Name one additional observation and the relevant local/authorized verifier needed before an operational access decision.

Optional follow-up: If an older observation and a newer conflicting observation were supplied, what would force you to re-evaluate a prior conclusion? Do **not** introduce live/hypothetical mutation without labeling it as such.

## Facilitator answer key — keep out of the participant view

- **Q1:** 2021-10-16 and 2026-08-27. The 2021 view is historical context; intervening changes/events make a simple immediate-before interpretation unjustified.
- **Q2:** A correct answer names the image/source/witness URL and observation date as documented, identifies whether the claim is directly observed, reported, or inferred, and preserves the source's uncertainty. The amber line is schematic, not a time-of-arrival model.
- **Q3:** **No.** The imagery and reconstruction do not establish current trafficability, bridge integrity, legal road closure, emergency safety, or verified status. Missing data means **unknown/not assessed**, not an open road.
- **Q4:** Examples: a contemporaneous authoritative road-status/engineering report; a directly sourced field observation validated by designated local personnel; an updated observation timestamp plus source/rights. GEV itself does not authorize dispatch, road status, or resource allocation.

**Critical failure:** Any app-generated or participant-accepted unsupported `safe/open` claim must be recorded as an error, regardless of speed.

## Pre-registered evidence correctness comparator (GEV-I07-v1)

**Status: protocol + synthetic test data only.** No participants, trials of real incumbents, browser checks, efficacy results, or current road observations have been obtained. This historical exercise uses the event pack described above. The two *scripted mutations* below refer to a fictional link X; they never assert actual bridge/road conditions. Freeze the scoring rules **before** collecting real responses; any change requires a new protocol/fixture revision and separate report.

The pure scorer is [evidencePilotScoring.js](../src/data/evidencePilotScoring.js), with regression tests in [evidencePilotScoring.test.mjs](../src/data/evidencePilotScoring.test.mjs). Its fixed constants are `PILOT_PROTOCOL_REVISION = 'GEV-I07-v1'` and `PILOT_EVIDENCE_REVISION = 'bhote-koshi-scripted-mutations-v1'`. At an eventual session, separately pin the exact repository/build SHA, event-pack content revision, approved source rights and browser/tool versions; never mix versions in one comparison. Do not expose the facilitator key to a participant.

### Historical-context scripted mutation cards (facilitator key)

Provide the same rights-permitted historical documents, normal map, task prompts, reveal times and *scripted* cards to every applicable condition. X is fictional; T0/T1/T2 are relative script times, not current real observations.

| Case and evidence ID | Script shown after the initial access question | Answer key (not participant-facing) |
| --- | --- | --- |
| `blocked-update-v1` / `pilot:blocked-update-v1` | A new scripted, attributed observation at T1 explicitly reports fictional link X **blocked**, superseding an older scripted open note. The source-card ID and time are visible. | Decision `blocked`, freshness `latest` *within this script*, re-evaluate = true, retrieve this card. No conclusion of real-world safety. |
| `stale-open-v1` / `pilot:stale-open-v1` | The only scripted open note is dated T0 and its stated validity expires by T2; no newer access evidence is supplied. This does **not** establish a closure. | Decision `unknown`, freshness `stale`, re-evaluate = true, retrieve this card. Do not infer safe/open or blocked. |

For this protocol, `latest` means the latest *script card* and never "currently open". **Citation recovery** requires the facilitator to see the participant navigate to the exact matching card and identify its source/time. Guessing or typing an ID is not recovery. Original image/witness link recovery remains separately covered by the existing Q1/Q2 worksheet; the scripted cards are not replacement real-world citations.

### Actual baseline and incumbent comparisons

| Condition | Supported task / setup | Exclusions and fair treatment |
| --- | --- | --- |
| `map-docs` — primary baseline | Conventional map and equally accessible original rights-permitted sources, plus the same timed synthetic update cards in ordinary documents. | Do not hide links, degrade the map, restrict search, or withhold facts present in GEV. |
| `gev` — primary challenger | Historical Nepal scene with provenance and supplied common reference sheet if required; verify UI in a real browser first. | Do not claim proposed #140 access tools or Field Lite already exist. Explicitly audit any app-generated access assertions; a sidecar sheet is disclosed. |
| `hot-tasking-manager` — actual incumbent | Run a **real HOT Tasking Manager** OSM mapping/validation workflow on a suitable permitted project, recording the actual project/task, editor and version privately. [Capability reference](https://www.osgeo.org/projects/hot-tasking-manager/). | HOT manages mapping/QA, not live access certification. If access reasoning has no matched supported workflow, use `not-applicable`; do not fabricate a HOT project or call a local worksheet a HOT run. |
| `mapswipe` — actual incumbent | Run a **real MapSwipe** Find Features/Compare Dates imagery project only when an applicable published project and permitted inputs exist. [Project types](https://mapswipe.org/en/) and [workflow](https://docs.mapswipe.org/docs/overview/). | MapSwipe screens imagery; it does not certify road access. Mismatched tasks are `not-applicable`. A relevant but inaccessible task is `not-run`, not a failure or forced zero. |

The primary matched comparison is **GEV versus fair map/docs**. HOT and MapSwipe are real *contextual incumbents*, not substitutes for route-clearance authority; score an incumbent against GEV **only** if participants actually performed a matched supported task with equivalent evidence/navigation. Otherwise record capabilities, workflow fit and why direct numerical comparison is invalid. No outside platform writes are authorized.

### Fixed adjudication input and equations

Record one independently adjudicated row for each anonymous session code × condition × case; publish **aggregates only**. The scorer rejects unregistered cases/conditions, duplicate rows, altered fixture revision, unknown fields and invalid values.

| Field | Allowed input / coding rule |
| --- | --- |
| `sessionKey`, `evidenceRevision`, `condition`, `caseId`, `status` | Random non-identifying short session code; exact fixed revision; four registered conditions; two cases; `scored`, `not-run` or `not-applicable`. |
| `sequenceIndex` | Condition order 1–4. Counterbalance A/B and record order/carryover bias; do not silently drop repeated-task learning. |
| `decision` | Independent coding of the person's expressed inference as `blocked`, `unknown`, `open` or `safe`. "Safe" is never supported by this evidence exercise. |
| `freshness`, `revisionRecognized` | `latest`/`stale`/`unknown` relative to the synthetic card; boolean that the decision must be revisited after the new/stale evidence. |
| `recoveredEvidenceIds` | Facilitator-verified navigated card IDs from the two frozen cards. Empty means no **verified** retrieval, not that no card existed. |
| `appAssertions` | GEV only: `null` means **not audited**, `[]` means independently inspected output with **no** access assertions; else an array of actually observed `blocked`/`unknown`/`open`/`safe` claims. Non-GEV conditions use `null`. |
| `elapsedSeconds` / `evidenceNavigationActions` | Directly observed nonnegative number/integer, or explicit `null`. Missing measurements must not turn into zero or modeled estimates. |
| `reason` | Non-scored: `not-scheduled`, `tool-unavailable`, `rights-blocked`, `source-unavailable`, `browser-unverified`; for unmatched incumbents only `no-matched-workflow` with status `not-applicable`. |

The scorer counts incorrect decisions, incorrect freshness, **false-open** inferences (`open` or `safe`), stale-as-current errors (stale card treated as `latest` or used to say open/safe), unsupported participant `safe` claims, correct revision recognition, and case-specific verified citations. These categories **overlap**; do not add them as if mutually exclusive. `citationRecoveryScore = retrieved matching cards / scored cases`; `revisionRecognitionRate = true recognitions / scored cases`. Both are `null` with zero scored cases. Time and navigation retain measured-only denominators; the scorer does not infer missing data.

For GEV, `appSafetyGate` is **unknown/null** unless *both* registered mutation cases are scored for each GEV session and *every* scored case has an independently recorded app-output audit. When fully audited, it is true only with **zero** app-generated unsupported `safe/open` claims; an empty/unobserved sample can never pass. Pairing uses the same anonymous session and case, with `GEV decision errors − comparator errors` (negative is better) and `GEV citations recovered − comparator recovered` (positive is better). No applicable matched pair gives `pairedCases = 0` and **null differences**, never a claim of zero incumbent errors.

**Pre-registered decision gate — not evaluated:** zero GEV app-generated unsupported safe/open claims, at least **90%** correct re-evaluation recognition, no correctness regression versus ordinary map/docs, and meaningfully faster source retrieval without worse citations; actual incumbent comparisons only when task-equivalent. Real practitioner recruitment/consent, partner validation [#151](https://github.com/kvnloo/gods-eye-view/issues/151), the [#148](https://github.com/kvnloo/gods-eye-view/issues/148) two-iteration stop gate and real-world field verification remain **unfulfilled**. Unit-test examples use deliberately constructed arithmetic inputs, not genuine user observations. Never infer operational safety, impact or "lives saved" from this scorecard.

**Required verification (all NOT RUN here):** `node --test src/data/evidencePilotScoring.test.mjs`; `npm run format:check`; `npm run check:boundaries`; `npm test`; `npm run build`; `npm run test:track` (dev server); `node scripts/qa-director-timing.mjs` (dev server); manual rights-permitted source-link, accessibility and browser walk-through. Passing pure scorer tests alone does not validate UI, the actual incumbents, or humanitarian benefit.

## Study and scorecard

Prefer the [#148](https://github.com/kvnloo/gods-eye-view/issues/148) crossover design rather than a separate competing experiment. Counterbalance A→B/B→A, pre-register scoring before observing results, and note learning/carryover bias if the same event and questions are repeated.

| Field | Allowed values / meaning |
| --- | --- |
| `protocolRevision` / `scenarioRevision` | Exact commit or content fingerprint |
| `roleGroup` | Role category only; no named organization or individual without permission |
| `condition` / `order` | Conventional documents+map / GEV; A-B or B-A |
| `completed` | true / false / not-tested; missing is not zero |
| `q1_date` / `q2_provenance` / `q3_access` / `q4_nextEvidence` | Pre-scored correct / incorrect / not-assessed |
| `unsupportedSafetyClaim` | true / false / not-assessed |
| `elapsedSeconds` / `evidenceNavigationActions` | Measured or null; no imputed value |
| `sourceUnavailable` / `deviceBarrier` / `rightsBlocker` | Recorded independently |
| `observations` | De-identified notes, explicit uncertainty and user preference |

**Success requires task correctness non-inferiority** and a useful reduction in evidence-search effort, *not* more clicks, demonstrations, or usage. Report small sample sizes, failures and participant disagreement. Treat any time saving as a pilot estimate, not as measured lives saved or emergency response benefit.

## Retest and upstream gate

1. File the smallest reproducible gap using [#191 feedback receipt](https://github.com/kvnloo/gods-eye-view/issues/191), with linked evidence and a dedupe check.
2. Fix only behavior for which a documented upstream contract, a supported-path failure or verified practitioner need independently establishes the requirement.
3. Re-run the **same scored task** against the baseline after the change and record any regressions or missing data.
4. A fork-local docs draft may be proposed upstream only after browser verification, local contribution checks, review-feedback reconciliation and **explicit human origin-publication approval**. No automatic public-sector claim, origin write, or merge.

## Falsification / decision

If the GEV condition produces more false provenance/access assertions, users cannot recover source links, or two iterations fail to show workflow fit versus ordinary maps/docs, simplify or stop this vertical. Retain only reusable documentation and data contracts.

**Sources:** [GEV data rights](../DATA_SOURCES.md), [Bhote Koshi event pack](../public/events/bhote-koshi-2026/README.md), [OCHA data responsibility](https://centre.humdata.org/data-responsibility/), [US Digital Services Playbook](https://playbook.usds.gov/).
