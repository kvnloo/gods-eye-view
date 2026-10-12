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
4. A fork-local docs draft may be proposed upstream only after browser verification, local contribution checks, review-feedback reconciliation and **Linear HITL authorization**. No automatic public-sector claim, origin write, or merge.

## Falsification / decision

If the GEV condition produces more false provenance/access assertions, users cannot recover source links, or two iterations fail to show workflow fit versus ordinary maps/docs, simplify or stop this vertical. Retain only reusable documentation and data contracts.

**Sources:** [GEV data rights](../DATA_SOURCES.md), [Bhote Koshi event pack](../public/events/bhote-koshi-2026/README.md), [OCHA data responsibility](https://centre.humdata.org/data-responsibility/), [US Digital Services Playbook](https://playbook.usds.gov/).
