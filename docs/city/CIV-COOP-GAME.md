# Civic Co-op: rebuild a city through possible-world turns

**Status:** downstream design, not implemented multiplayer, a simulator, a civic authorization system, or a claim of public benefit. The playable unit is a **version of a hypothetical city proposal**, not an action on the real city.

**Product objective:** turn City builder into a cooperative, Civilization-like planning exercise in which people can try constrained alternatives, challenge their assumptions, and produce better-evidenced plans for local review. Progress means improved **decision quality and verified work**, not clicks, XP, popularity, territorial control, or disaster engagement.

**Decision references:** [factory goal #324](https://github.com/kvnloo/oss-factory/issues/324), [city infrastructure #180](https://github.com/kvnloo/gods-eye-view/issues/180), [co-op redesign #184](https://github.com/kvnloo/gods-eye-view/issues/184), [impact/adoption #187](https://github.com/kvnloo/gods-eye-view/issues/187), and [World Commons safety gate #150](https://github.com/kvnloo/gods-eye-view/issues/150). The [World Game preview PR #298](https://github.com/kvnloo/gods-eye-view/pull/298) is an opt-in, synthetic comparison prototype, **not** evidence of working shared rooms or impact models.

## 1. What today's City builder actually owns

This design starts at [`CITY-BUILDER.md`](CITY-BUILDER.md) on `feature/city-builder` at `ee4856e8d585c328a4f6b642f9b36b6982918625`:

| Existing owner | Supported today | Not supported today |
| --- | --- | --- |
| [`src/standalone/cityPlanningServices.js`](../../src/standalone/cityPlanningServices.js) | Capture current Cesium pixels, camera, map bounds, timestamp and selected-source citation; one local writer via Web Locks | Surveyed parcel, source-rights clearance, shared server or authoritative baseline |
| [`src/data/cityPlanningDocument.js`](../../src/data/cityPlanningDocument.js) | Strict `city-builder` v1 JSON, immutable reference, 6 alternatives, 20 versions each, parent-revision guard, replayable hypothetical operations, 4 MiB document limit | Arbitrary new fields, independently authenticated authorship, permissions, simulation outcomes or approvals |
| [`src/ui/cityBuilder.js`](../../src/ui/cityBuilder.js) and [`CityBuilderEditor.vue`](../../src/ui/views/panels/CityBuilderEditor.vue) | Local authoring, restore-as-new-version, comparison, opt-in Imagine, validated import/export, single-browser storage | Multiplayer turns, estimated effects, a collective decision |
| [`src/data/communityPlanning.js`](../../src/data/communityPlanning.js) and [`src/data/collaborationAuthority.js`](../../src/data/collaborationAuthority.js) | Hypothesis records, deterministic merge projections, append-only evidence claims and revision-owned authority-operation rules | Authentication of actors or civic credentials merely from recorded operations |
| [`src/ui/communityPlanningPreview.js`](../../src/ui/communityPlanningPreview.js) / [`src/ui/stores/communityPlanning.js`](../../src/ui/stores/communityPlanning.js) | Game view focuses one proposal; co-op view compares proposals. The PR #298 fixture uses synthetic markers and no transport | An actual game turn, synchronized room, surveyed geometry or completed community review |

Current parameters are `kind` (park / bike lane / plaza), proposed `trees`, `widthMeters` and `shadePercent`. **Inputs are not effect estimates.** Local fixture concept images are samples; opting into the local ChatGPT bridge explicitly sends the frozen reference and description to a provider. Images are not plans, forecasts, permission, or approval.

Imported citations and author names are unverified. `replayCityDocument` reconstructs authored hypothetical operations, **not** collaboration or authority state. Do not turn the local `co-op` display label or `local-author` operation ID into evidence that multiple people participated.

## 2. The cooperative turn loop

A *session* is a named exercise anchored to one immutable captured reference and a written community-defined mission (for example, compare a proposed park against a bike lane under a hypothetical budget). A *round* can contain several candidate moves. No time pressure, resource harvesting, territory conquest, or popularity leaderboard is necessary.

1. **Observe / frame.** Freeze the baseline reference, source revisions, known gaps, and what the participants are permitted to use. Agree on goals, affected users, a scenario budget if meaningful, and a visible stop rule. If the reference is insufficient, collect evidence; do not award progress.
2. **Propose a move.** A participant edits or forks an alternative with a stated intent and tradeoff. Saving creates **one new possible-world version** against a specific parent revision. Other alternatives and the observed reference do not change.
3. **Estimate, not invent.** Optional, domain-specific evaluators return a baseline-versus-proposal *estimate with uncertainty*, provenance, assumptions and explicit missing values. Until an evaluator exists, display `not evaluated`; proposed tree count, width or shade remain proposed inputs, not modeled benefits.
4. **Review together.** Other participants inspect differences, suggest revisions, challenge sources, surface who might be worse off, and record review receipts. A revision conflict remains visible. Discussion, voting or a facilitator's choice is **not** municipal approval.
5. **Choose the next hypothetical round.** Mark one or more alternatives *selected for further exploration*; compare tradeoffs against the mission, then repeat from the selected version or export an evidence-linked brief for the actual civic process. A choice cannot modify real infrastructure, observed facts or approved status.

`Observe → Propose version → Estimate with uncertainty → Review → Choose next hypothetical version → Repeat / external handoff`

### What counts as a move

A move is the successful addition of a **versioned hypothetical proposal**, not opening Game view, pressing Imagine, leaving a comment, voting, or selecting a winner. The minimal conceptual receipt is:

`moveId, sessionId, alternativeId, fromRevision, toRevision, actorId (recorded, unverified), baselineRevision, proposalKind, parameters, intent, assumptions, createdAt`

The existing `reviseCityAlternative(document, id, parentRevision, edit)` is the source of truth for its version transition. A stale `parentRevision` rejects instead of overwriting. Keep turn/review/goal metadata in a **separately validated companion session record**, not extra keys silently injected into the strict City builder v1 export. Stable references to `project.id`, `alternative.id` and version numbers join the two. A room may later exchange those records, but only with explicit participant consent and an actually supported transport.

A round may spend **hypothetical** resources (staff capacity, space, time, or a user-supplied budget). Show amounts as assumptions or sourced estimated ranges; never imply that funds, land, labor, or permissions are secured. Multiple proposals may be retained rather than forcing a fake single winner.

## 3. Shared goals: a scorecard without engagement scoring

The group sets measurable targets and minimum safeguards **before** seeing results. Each record carries metric ID, unit, direction, affected area/group, baseline and proposal estimate, uncertainty method and bounds, source URL/license/revision, model version, input/seed, evaluated time, assumptions, and `known | unknown | stale | incompatible` status.

| Shared goal | Candidate outcome measure, only when the needed model/data exists | Critical uncertainty / safeguard |
| --- | --- | --- |
| **Walkable access** | Estimated share of destinations or residents within a defined accessible walking time of the proposed amenity | Needs permitted network and population data, verified crossings/obstacles and a specified accessibility standard; without them: **unknown**, not zero or compliant |
| **Heat / shade** | Estimated change in usable pedestrian shade area (m²) or heat exposure during a stated period | Requires canopy/solar model, season, maturity and conditions; `trees` and `shadePercent` alone are **inputs**, not canopy growth or cooling |
| **Safe mobility** | Modeled person-delay / pedestrian crossing delay, compared at the same demand, network revision, window and seed | Traffic or safety models must disclose assumptions, spillback, pedestrian/transit tradeoffs and sensitivity; never control live signals or claim a safe route |
| **Affordability / resilience** | Itemized estimated lifecycle cost range; optional flood/service-disruption exposure from a qualified domain model | Sources must state date, units and scenario; missing costs or exposure remain unknown, not free or safe |

Display metrics **side by side**, not combined into an opaque victory score. `Proposed trees: 20` is a proposal input, not a goal achieved. Where estimates exist, show their interval or sensitivity range and the evidence's quality; intervals are **not statistical confidence intervals unless the method supports that interpretation**. If baseline and proposed assumptions or model revisions differ, refuse direct comparison. If uncertainty overlaps the decision threshold or key population data is absent, mark **inconclusive**.

Progress = transparent improvement against pre-agreed thresholds **without breaching a safeguard**, plus useful verified artifacts (e.g., a correctly validated map edit or a sourced comparison). No points for opening a scene, time spent, followers, survey votes, volume of speculative edits, crisis severity or donation popularity. A success claim needs a real decision owner and an evaluation against their existing workflow; otherwise label it a learning result only.

## 4. Co-op roles and authority boundary

| Role | Useful contribution | Authority it does **not** gain |
| --- | --- | --- |
| Resident / proposer | Offer a possible-world version, state local needs and assumptions | Land rights or the right to build |
| Mapper / evidence steward | Verify source date, license, geometries, accessibility gaps and disputed claims | Power to change observed data by editing a proposal |
| Domain modeler | Supply methods, reproducible estimates, ranges and uncertainty notes | Power to turn an estimate into a fact |
| Accessibility / equity reviewer | Test distributional impacts and underserved paths; request alternatives | Veto through unverified identity or a popularity tally |
| Facilitator / local steward | Convene a round, preserve disagreement, choose exploration order under agreed process | Public permit, funding, emergency dispatch or official sign-off |
| Actual civic decision owner (**outside GEV**) | Receive a read-only, attributable brief and use the native public process | No implicit approval through a GEV import, reaction or game state |

A participant label is a recorded pseudonymous contribution marker, not identity verification. Reviews are linked to exact versions and evidence; attribution survives export/import but remains **unverified** until checked. No remote collaborator may move the camera, enable microphones, publish private location, or trigger effects without local confirmation. Governance, moderation, consent, licensing and spam/Sybil defenses precede any public room. Reuse [existing collaboration work #65](https://github.com/kvnloo/gods-eye-view/issues/65)–[#73](https://github.com/kvnloo/gods-eye-view/issues/73) instead of inventing a second transport; verify its actual availability before enabling sync.

**Hard separation:** `observed`, `estimated`, `simulated`, `hypothetical`, `reviewed` and `approved` are different claims. GEV may record a link to an external authoritative decision **after independent verification**; it never mints an approval receipt because a team votes or a modeled target turns green.

## 5. Failure, recovery, and stopping rules

| Failure / blocker | In-game behavior |
| --- | --- |
| Unverified or stale source; unusable baseline; missing model input | Mark affected goal **unknown / stale** and disable success claims; retain the proposal and ask for provenance, never silently substitute zero |
| Parent revision changed, duplicate operation, offline divergence | Reject stale overwrite; offer fork/diff/retry against an explicit head; never silently merge conflicting scenario versions |
| Estimated goal gets worse, marginalized access regresses, or budget interval is exceeded | Display the tradeoff and failing safeguard; revise or retain competing alternatives, never bury it in a total score |
| Unsupported permit, ownership, safety or operational claim | Block approval/export-as-official and provide a non-authoritative draft handoff only |
| Source-license/privacy/consent violation, spam or unsafe room state | Do not share or sync; preserve local work safely and require human moderation or consent |
| Engagement grows but validated task accuracy/outcomes do not | Stop or simplify the game layer; compare against direct use of the source tool before further rollout |

The cooperative mission **fails well** when it produces an honest `unknown`, documented conflict, safer rejected proposal, or explicit no-build option. These are legitimate planning outcomes, not lost points. The wider World Commons missions in [#150](https://github.com/kvnloo/gods-eye-view/issues/150) remain gated by practitioner evidence and safeguards; city-game design does not unblock them.

## 6. Five smallest incremental build steps (each demands a RED-on-base / GREEN-on-change test)

These are **proposed future steps, not files or tests implemented by this design commit**. Each step is an isolated fork-local change with no new approval or public-room claim.

| Step / owner boundary | Smallest runnable slice | Required `node:test` (new unless noted) |
| --- | --- | --- |
| **1. Pure turn receipt** — `src/data/civCoopTurn.js` calling the current city document API | Record a session and immutable move linking exact `project.id`, alternative, reference and parent/next revision. Reject stale parent, bad input, duplicate ID and any baseline mutation; keep v1 project JSON unchanged. | `src/data/civCoopTurn.test.mjs`: valid move advances one hypothetical version; stale/replayed moves reject, baseline bytes remain identical |
| **2. Honest goal projection** — `src/data/civCoopScorecard.js` | Accept *explicitly supplied* estimator receipts; render units, bounds, freshness, comparability and unknowns; no built-in magic conversion of trees/width into impact. | `src/data/civCoopScorecard.test.mjs`: no evaluator means unknown; dissimilar source/seed cannot rank; same-basis bounds and safeguards remain intact |
| **3. Local turn UI** — existing `src/ui/cityBuilder.js`, `src/ui/views/panels/CityBuilderEditor.vue` and existing Pinia presentation owner | Add opt-in mission + turn timeline, one `Propose next version` action, compact uncertainty scorecard, review/inspection affordances. Preserve keyboard/focus, one-Scene-dialog rule, Game/co-op local labels and explicit Imagine transfer gate. | Extend existing `src/ui/cityBuilder.test.mjs`: proposal is versioned, local-only and never changes baseline/authority or calls the generator implicitly; add a mounted Vue view test for rendered unknowns |
| **4. Offline two-person exchange** — `src/data/civCoopExchange.js` + existing import/export boundary | Export separately validated session/review receipts alongside unchanged City builder v1 data; import and replay deterministically. Preserve authorship as *recorded, not verified*; show concurrent branch conflict rather than silent replacement. | `src/data/civCoopExchange.test.mjs`: two independent edits, export/import, duplicate replay, conflicting heads and malicious approval injection remain correctly distinguished |
| **5. Opt-in room adapter, only after existing room/consent contract is verified** — integration at `src/standalone/cityPlanningServices.js` / existing community-planning store | Reuse the established #65–#73 room operation seam if actually available; sync hypothetical turn/review receipts only, never live actions, authorizations or private presence. Keep disabled without moderation and verified permissions. | `src/standalone/civCoopRoom.test.mjs`: reordered/duplicated/reconnected peer operations converge for nonconflicting proposals, expose divergent heads and cannot authorize or remotely trigger effects |

First re-run current adjacent regressions `node --test src/data/cityPlanningDocument.test.mjs src/ui/cityBuilder.test.mjs src/ui/communityPlanningPreview.test.mjs`. A future Vue test uses the repository's `node --import=./build/registerVue.js --test <test-file>` convention. Browser-level evidence remains `QA_BASE_URL=http://127.0.0.1:4187 node scripts/qa-city-builder.mjs` after the local dev server is running. None are executed or added by this documentation change.

## 7. Release / adoption gate

Start with two alternatives, two offline participants and one *historical or synthetic* neighborhood exercise. Test whether their sourced decision brief, missed-uncertainty rate and task correctness improve over a plain map + spreadsheet (or the source planning tool) **before** adding public rooms, badges or more city systems. Record task completion and correct validation, not return visits. Obtain actual source-owner/municipal feedback before any claim of city effectiveness.

**Not a civic decision:** neither a game round, synthetic preview, concept image, community selection nor an import constitutes permission, site suitability, official policy, funding, a safe-route assertion or a construction approval. Preserve original upstream and PR #298 contributor provenance if implementation is later proposed.