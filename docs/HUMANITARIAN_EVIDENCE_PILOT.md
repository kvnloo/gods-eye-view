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

The original Nepal presentation and source reconstructions belong to their respective upstream contributors and data owners; this exercise does not claim authorship of the event data or scene. See [Director attribution](../docs/DIRECTOR.md) and the pack credits.

## Facilitator preparation (not yet a checked browser recipe)

1. Pin a repository commit and capture app/browser/device, data-provider availability, rights state and local time for the session. Install using [Quick Start](../README.md#-quick-start) or Node.js 24.14+/26 and `npm ci && npm run dev`.
2. Confirm that the existing **Nepal flood scene** is actually reachable in this checkout. Record the *exact current click path and labels* in session notes. **Block a user-facing step-by-step tutorial until verified.** Do not assert that the pending disaster-access workspace in [#140](https://github.com/kvnloo/gods-eye-view/issues/140) is already in the application.
3. Confirm the two comparison dates, embedded credits and at least one source link. If a source is missing/blocked/rights-unclear, record `unavailable`; do not fill it from memory.
4. Prepare **Condition A**: conventional source documents + normal map showing the same permitted material. **Condition B**: the same evidence in GEV's existing Nepal scene. Do not provide candidate road-closure labels unless they exist in cited sources.
5. Prepare a cheap 2D fallback and an accessibility alternative, but **do not claim that an offline or Field Lite build exists or works** until [#146](https://github.com/kvnloo/gods-eye-view/issues/146) independently demonstrates it.
6. Ask for informed consent; record no participant identity, contact details, personal health, precise private location, unapproved recordings, or sensitive response data in public issues. Use an approved private intake for anything sensitive.

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
