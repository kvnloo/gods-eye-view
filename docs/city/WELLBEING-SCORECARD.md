# City wellbeing scorecard: one scorecard per street option, by income group, with the money next to it

Proposal for [CITY-INFRA-WAVE #180](https://github.com/kvnloo/gods-eye-view/issues/180) phase 4 (co-op city) and [#194](https://github.com/kvnloo/gods-eye-view/issues/194) civic handoff. Research and sources: [`WELLBEING-RESEARCH.md`](WELLBEING-RESEARCH.md). Brand open ("Possible City" is taken by unrelated companies). Proposal only: it does not change #180's gates, and nothing here is approval, prediction or measured benefit.

## 1. The moment we want

A councilmember, a planner and a utility engineer sit at one screen. Someone
says:

> "Make Mira Mesa Blvd safe for the kids who walk to Mira Mesa High, keep
> buses on time, and stay under $2 million."

Within seconds:

1. **The globe flies to the street** (GEV). The _Observed_ layers rise:
   crashes (CrashIQ), counts and speeds (DemandIQ), delay/LOS at each signal
   (TrafficOpsIQ), Healthy Places Index by tract, Tree Equity, heat,
   Opportunity Atlas. Each layer is labelled with its source and date.
2. **Three options appear as branches in _Possible_** (StreetIQ cross-sections
   in the right-of-way): e.g. A road diet + protected lanes, B signal and
   crossing upgrades only, C trees + bus queue jumps.
3. **One scorecard per option**, the same columns every time:

   |                                                                  | A   | B   | C   |
   | ---------------------------------------------------------------- | --- | --- | --- |
   | Injuries/deaths avoided per yr (CMF-based, tier)                 |     |     |     |
   | Wellbeing gained (WELLBYs) — **Q1 … Q5 income**                  |     |     |     |
   | Up-front cost / lifecycle liability (30 yr)                      |     |     |     |
   | Monetised benefit (USDOT BCA + WELLBY), B/C                      |     |     |     |
   | Operations: peak delay, LOS, bus travel time                     |     |     |     |
   | Tax value per acre on the frontage                               |     |     |     |
   | Who pays / displacement risk                                     |     |     |     |
   | Confidence: measured · published method · modelled · transferred |     |     |     |

4. **Ask why** on any cell → the trace (equation, input, source), exactly like
   TrafficOpsIQ today.
5. **Hand off**: export the HSIP/ATP grant BCA, a council staff-report draft,
   and a resident one-pager in plain language. The option moves to
   _Coordinated_ only when the agency's own record (agenda item, project ID)
   is linked. _Measured_ comes after the counts and crash data come back.

That is the ChatGPT moment: plain words in, your own street out, the money
and the people on the same page, and nothing hidden.

## 2. Who uses it and what each one needs to see

| Persona                           | Their question                                           | What closes it                                                    |
| --------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------- |
| Elected official / CFO            | "What does it cost us over 30 years and what do we get?" | lifecycle liability, B/C, tax value per acre, grant match         |
| City/transport planner            | "Which option, and will reviewers accept it?"            | HCM/HSIP-grade numbers, method tier, agency profile               |
| Street designer / architect       | "Does it fit and does it feel good?"                     | StreetIQ section, 3D street view, shade/heat, public-life targets |
| Utility (water, power, broadband) | "Can we dig once?"                                       | conflicts with planned utility work, coordinated trench schedule  |
| Public health / equity office     | "Who benefits, who is displaced?"                        | per-quintile wellbeing, HPI/Opportunity Atlas overlays            |
| Residents                         | "What changes for me?"                                   | plain-language card, their block, their commute                   |

## 3. Where the civ / city-builder game fits (and where it must not)

Use the Kingdom of Hex / GEV World Builder layer as a **council table**:
stakeholders take turns spending a real budget envelope across real options,
and see the scorecard and the per-quintile bars move. That is MIT CityScope's
proven pattern (engagement through play) applied to real numbers.

It must not count votes, award points or rank people. GEV #150 (World
Commons) is BLOCKED until a practitioner study exists. The table records
choices and reasons; decisions stay in the council's own process.

## 4. Why we can build it (reuse, not rebuild)

| Need                 | Already built               | Missing                                                                                                                                 |
| -------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Globe, layers, voice | GEV + user layers           | civic layer pack                                                                                                                        |
| Branching proposals  | GEV #185/#229/#253 (drafts) | one exact-head browser run                                                                                                              |
| Safety numbers       | CrashIQ                     | CMF library wiring for options                                                                                                          |
| Ops numbers          | TrafficOpsIQ (HCM Ch 19–22) | —                                                                                                                                       |
| Volumes / mode shift | DemandIQ                    | mode-shift elasticity per option (modelled tier)                                                                                        |
| Street sections      | StreetIQ                    | 3D handoff into GEV                                                                                                                     |
| Wellbeing            | —                           | **WELLBY ledger**: HIA pathways (activity, air, noise, heat, crashes, green) → life-satisfaction deltas, Green Book value, per quintile |
| Money                | —                           | **lifecycle cost ledger** (capex, O&M, renewal) + tax value per acre                                                                    |
| Equity layers        | —                           | HPI 3.0 (free ArcGIS), Opportunity Atlas, Tree Equity ingest                                                                            |

The two new pieces are ledgers, not engines. Both are pure code over
published values, so they keep the "code computes every number" rule.

## 5. Hypotheses (Savoia XYZ) and pretotypes

| #   | Hypothesis                                                                                                          | Pretotype                                                          | Skin in the game                |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------- |
| H1  | ≥30 % of CA city traffic/planning staff shown a 60 s film of the scorecard on their own corridor book a walkthrough | **The film** (below) + fake-door "Run my street"                   | a booked 30-min call            |
| H2  | ≥3 of 10 councilmember offices forward a one-page per-quintile scorecard to staff                                   | Mechanical Turk: we hand-build the scorecard for one real corridor | forwarded email / staff request |
| H3  | ≥1 of 5 consultants pays for a grant-BCA export on a live HSIP/ATP application                                      | Pinocchio: export is a pre-filled spreadsheet                      | purchase order or LOI           |
| H4  | Residents understand the trade-off: ≥70 % pick the option the scorecard ranks best for their own quintile           | Council-table game on a laptop at one community meeting            | completed sessions              |

Every pretotype uses real geometry and real public figures with sources;
modelled numbers are watermarked SIMULATED until computed by code.

## 6. Film brief (for the video session)

Film handoff lives in kvnloo/launch-videos `films/HANDOFF-city-wellbeing.md`. Core:

- **Idea in 3 s:** _"Every street is a budget decision. Now you can see who it
  makes happier."_
- **Recurring character:** the scorecard row. It slides in for each option,
  the per-quintile bars fill, the $ column ticks.
- **Beats (≈60 s):** voice ask → globe flies to Mira Mesa Blvd → Observed
  layers rise with source chips → three Possible branches split → scorecard →
  "why?" tap opens a trace → council table turn → export packet → end card.
- **Real public numbers allowed on screen** (with source chip): WELLBY
  £15,920 (Green Book 2024 prices); Barcelona superblocks 667 deaths/yr,
  €1.7 bn/yr (modelled HIA); Helsinki €15k/person/yr; Wales 20 mph −25 %
  injured; Copenhagen DKK 4.80/bike-km; PlanAssist −58 % task time.
- **Never on screen as fact:** any number for Mira Mesa we have not computed.
  Leave slots blank or watermark SIMULATED.

## 7. Fit with #180's gates

The scorecard is a read-only consumer of #180's phase-0 contract (scenario
comparison receipt at equal inputs) and phase-4 co-op proposals (#185/#229).
It adds two pure ledgers (wellbeing, lifecycle cost) and never writes
Observed facts, changes live signals or records approval (#180 boundaries
1–3). Each row carries #145's state and a method tier.

## 8. Next units (smallest first)

1. Ingest HPI 3.0 + Tree Equity for one San Diego corridor as a GEV user
   layer (both are free services). S.
2. WELLBY ledger v0: three pathways only (crashes, physical activity, heat/
   trees), published coefficients, per-quintile split, unit tests from the
   published worked examples. M.
3. Hand-built scorecard for Mira Mesa Blvd (H2 Mechanical Turk). S.
4. Film (H1) from the video session's pipeline. M.
5. Exact-head browser run of GEV #229 so the branching preview is real, not
   mocked (existing carrier; command list in oss-factory #289). S.
