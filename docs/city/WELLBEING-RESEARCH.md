# City wellbeing research: humane cities that also balance the budget

Researched 2026-11-05. Downstream research for [CITY-INFRA-WAVE #180](https://github.com/kvnloo/gods-eye-view/issues/180) and [IMPACT-WAVE #187](https://github.com/kvnloo/gods-eye-view/issues/187); product proposal in [`WELLBEING-SCORECARD.md`](WELLBEING-SCORECARD.md). No code, no origin claim. Every outside fact has a numbered source (§8).
"(snippet)" = claim rests on search-result text, not the full page.
"(memory)" = from our own past chats, not re-verified.

The question: can we build one product that architects, planners, street
designers, elected officials, finance staff and utilities all use to make a city
measurably happier, and that respects the budget? And can it feel like a
ChatGPT moment: ask in plain words, see the answer on your own street?

Short answer: yes. The overlap between the humanitarian case and the
bottom-line case already has a shared currency, and governments use it
officially. That currency is **wellbeing per dollar, with the lifecycle cost of
the asset next to it** (§5). No tool on the market shows both for the same
street, broken down by income group, with every number traceable. Most of the parts already exist in this fork and the TrafficIQ suite (§1).

---

## 1. What we already have (inventory, read from local repos and issues)

| Asset                                 | What it gives the new product                                                                                                                                                                                                                                                                           | Where                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **God's Eye View (GEV)** fork         | Photoreal 3D globe, live layers, voice agent, user layers. Our fork adds the **four-state contract**: Observed → Possible → Coordinated → Measured (#145). Rendering a plan is never approval; funded ≠ built ≠ effective                                                                               | this fork: #137–153, #180–184, #194                                                                |
| GEV community planning                | Versioned proposal branches with two alternatives, no invented approval (#185); Scene preview comparing alternatives (#229); World Builder with reversible markers and an A/B "non-prediction" receipt (#253); historical-earth lens (#261). **All drafts; none has a current-head native/browser run** | oss-factory #289, comment `GEV1104-RECALL-CITY`                                                    |
| GEV humanitarian workspace            | Nepal flood evidence playback (origin #590, merged), World Packet (origin #880, merged), data-protection policy (#157, CI green), Field Lite (#240)                                                                                                                                                     | oss-factory #289, comment `GEV1104-RECALL-HUM`                                                     |
| **civ-gamification / Kingdom of Hex** | Civilization-style hex world with cities, `celebrate()`, `focus()`, `setState()`; currently a cockpit for OSS-factory work                                                                                                                                                                              | [kvnloo/civ-gamification](https://github.com/kvnloo/civ-gamification)                              |
| **TrafficIQ suite**                   | StreetIQ (cross-sections inside right-of-way, HDM/MUTCD/NACTO checks), CrashIQ (CCRS crash profile, HSIP outputs), DemandIQ (counts and forecasts), TrafficOpsIQ (HCM delay/LOS/queues, every number traced to an equation)                                                                             | [kvnloo/trafficiq](https://github.com/kvnloo/trafficiq), streetiq, crashiq, demandiq, TrafficOpsIQ |
| Recorded real corridors               | Mira Mesa Blvd (15 intersections), La Jolla Blvd Bird Rock (5 roundabouts) as golden fixtures                                                                                                                                                                                                           | TrafficOpsIQ `tests/golden/osm/`                                                                   |
| smartcity                             | Chicagoland SUMO + Unreal twin (load tests only, never accuracy evidence)                                                                                                                                                                                                                               | kvnloo/smartcity                                                                                   |
| Film pipeline                         | fframes launch films; TrafficIQ launch v1 rendered 2026-11-05                                                                                                                                                                                                                                           | kvnloo/launch-videos `films/trafficiq-launch-v1`                                                   |

Locked rules that carry over and are the moat: **code computes every number;
refuse rather than guess; every number carries its method tier; mocked data is
watermarked; no points/reputation system may become civic authority** (GEV
#150 is BLOCKED until a practitioner study exists).

---

## 2. Where the industry is going (2025–2026)

1. **From "digital twin" to "digital twinning".** The 2026 framing is a
   continuing planning practice, not a 3D model you buy once [1]. UNDP's 2025
   brief pitches twins as the way to test strategies before spending, because
   physical trials are expensive [2].
2. **Agentic AI on top of twins.** "Towards fully automated city operations"
   (CEUS, 2026) wires generative/agentic AI to urban twins through the Model
   Context Protocol (MCP) [3]. "Agentic Urban Digital Twins" (2026) argues
   twins under-represent social complexity and ethics, and proposes human–AI
   co-learning [4]. Direction: agents act; humans keep authority.
3. **AI already beats or matches planners on narrow tasks.** Tsinghua's deep
   RL land-use and road layout planner (Nature Computational Science, 2023)
   beat human experts on service/ecology metrics in Beijing community blind
   tests, as a human–AI workflow [5]. Generative 3D city models are now
   research-grade: UrbanWorld [6], CityDreamer [7]. CityGPT adds spatial
   cognition to LLMs [8].
4. **LLMs as stand-in residents.** LLM-empowered participatory planning
   simulates resident agents debating land use [9]; LiPUP-MA puts "lived
   experience" into the loop [10]; a Seoul study tested ChatGPT inside a
   planning support system [11]. Useful for rehearsal, never a substitute for
   real residents.
5. **Government AI that ships is boring and measurable.** UK PlanAssist
   (Faculty, Google DeepMind, UK government): key householder-application tasks
   take **58 % less time**, Beta expanding to **15 councils**, officer stays in
   control [12]. US startups attack permitting: Govstream.ai ($3.6M) [13],
   Verdant (YC) [14]; UK Xylo (£2.8M pre-seed) [15].
6. **Incumbent planning tools** focus on massing, zoning and scenarios:
   Autodesk Forma, Giraffe, UrbanFootprint, ArcGIS Urban [16] (aggregator
   rankings, weak evidence). None leads with resident wellbeing by income
   group, or with lifecycle liability.
7. **National-scale twins exist and are the reference points.** Virtual
   Singapore, the first country-scale twin, by SLA [17]; Helsinki's open 3D
   city model and Energy & Climate Atlas, downloadable via WFS [18]; Hangzhou's
   City Brain moved the city from 5th to 57th most congested in China (vendor
   claim, 2019) [19]; Toyota Woven City got its first residents in Sept 2025 [20].
8. **MIT CityScope** proved tangible, game-like tables get non-experts to
   engage [21]. That is the honest precedent for our civ/city-builder layer.

**What nobody combines:** a twin + an agent + a money ledger + a wellbeing
ledger split by income, with each number tied to its method and source.

---

## 3. What countries optimised, and what it bought them

| Place              | What they optimised              | Mechanism                                             | Measured or modelled result                                                                                          | Money                                                                                                                                                        |
| ------------------ | -------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Copenhagen         | cycling, public life             | network + Gehl public-life counts [22]                | #1 EIU Liveability 2026 [23]; #1 Happy City Index 2026 [24]                                                          | Danish key values: each extra bike-km is a **DKK 4.80 social gain**, each car-km a **DKK 5.28 cost** [25]; cycle superhighways return 11 % (DKK 5.7 bn) [26] |
| Vienna             | housing affordability            | ~half the population in social/municipal housing [27] | #2 EIU 2026 [23]; rents ~⅓ of London/Paris (snippet) [27]                                                            | city owns and manages 220,000 units [27]                                                                                                                     |
| Barcelona          | street space from cars to people | superblocks                                           | full plan modelled to prevent **667 premature deaths/yr**, ~200 days life expectancy each, **€1.7 bn/yr** saved [28] | modelled (health impact assessment), not measured                                                                                                            |
| Helsinki / Finland | homelessness                     | Housing First; city owns 70 % of land [29]            | only EU country with falling homelessness [30]                                                                       | **~€15,000/person/yr saved** in emergency health, social and justice costs [29]                                                                              |
| Singapore          | integration + ownership          | HDB towns; Ethnic Integration Policy (1989) [31]      | ~80 % live in HDB flats, ~90 % of them own [32]; #3 Happy City Index [24]                                            | CLC Liveability Framework: economy × environment × quality of life, trade-offs explicit [33]                                                                 |
| Wales              | long-term wellbeing as law       | Well-being of Future Generations Act                  | cancelled a £1.4 bn motorway (2019); national 20 mph: **25 % fewer people hurt** in 18 months [34]                   | active-travel 45 % target by 2045 [34]                                                                                                                       |
| Netherlands        | road safety                      | Sustainable Safety / safe-system design [35]          | among lowest EU road deaths (EU country profile) [35]                                                                | design, not enforcement                                                                                                                                      |
| Pontevedra (ES)    | pedestrian centre                | car-free core since ~1999                             | <12 car deaths in two decades (snippet) [36]                                                                         | —                                                                                                                                                            |
| Seoul              | stream over a freeway            | Cheonggyecheon restoration                            | biodiversity +639 %, 200-yr flood protection [37]; CBA published [38]                                                | —                                                                                                                                                            |
| Medellín           | access for informal hillsides    | Metrocable + social urbanism                          | studies link Line K to crime reduction (contested, long-run) [39][40]                                                | —                                                                                                                                                            |
| Tokyo / Japan      | housing supply                   | national, permissive zoning [41]                      | stays affordable at megacity scale [41]                                                                              | —                                                                                                                                                            |
| Dubai              | resident sentiment               | Happiness Meter on every service [42]                 | 58 M votes since 2015; index 96 % in 2023 [42]                                                                       | self-reported by government; satisfaction, not life evaluation                                                                                               |
| Bhutan             | national happiness               | GNH Index, 9 domains [43]                             | 2022 index published [44]                                                                                            | —                                                                                                                                                            |
| Estonia            | government time                  | digital state                                         | claims ~**2 % of GDP**/yr saved [45]                                                                                 | government claim                                                                                                                                             |
| Brazil (PB)        | spending priorities              | participatory budgeting                               | more spend on sanitation/health, **lower infant mortality** in adopting municipalities [46]                          | —                                                                                                                                                            |

Patterns that repeat: (a) the winners **measured first and kept counting**
(Gehl counts, Danish key values, Santa Monica index); (b) they **priced
wellbeing in the treasury's own units** (Denmark, UK, Wales); (c) the big
health wins come from **street space and housing**, not gadgets; (d)
participation works when it **controls real money** (Porto Alegre), not
points.

---

## 4. How city happiness and quality of life are measured

### 4.1 Benchmarks

| Benchmark                                | Unit                                                                                                   | What it measures                                                                     | Use for us                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| EIU Global Liveability Index 2026 [23]   | 173 cities                                                                                             | stability, health, culture/environment, education, infrastructure (expert-rated)     | expat/business lens; not equity                                                                      |
| Happy City Index 2026 [24]               | 251 cities, 64 indicators, 6 dimensions (citizens, governance, environment, economy, health, mobility) | objective composite                                                                  | dimension list to align with                                                                         |
| IMD Smart City Index 2026 [47]           | 148 cities, ~120 residents/city, 3-year weighted                                                       | **resident perception** of structures + technology; grouped by HDI                   | housing affordability is the top priority in 2025 [48]                                               |
| World Happiness Report 2026 [49]         | countries (Gallup)                                                                                     | life evaluation, Cantril ladder 0–10                                                 | national baseline                                                                                    |
| OECD Regional Well-Being [50]            | 467 regions, 11 topics                                                                                 | objective + life satisfaction                                                        | regional comparator                                                                                  |
| US Social Progress Map 2025 [51]         | US cities/neighbourhoods, 50 measures                                                                  | basic needs, foundations of wellbeing, opportunity                                   | **six of the top 10 US cities are in California** (San Ramon #1, Pleasanton #2)                      |
| ISO 37120 / 37122 / 37123 (WCCD) [52]    | certified cities                                                                                       | sustainable / smart / resilient indicator sets                                       | data schema a city can be audited against; Toronto triple-certified                                  |
| UN-Habitat City Prosperity Index [53]    | 300+ cities, 6 dimensions                                                                              | productivity, infrastructure, QoL, equity, environment, governance                   | global south comparator                                                                              |
| Bhutan GNH [43]                          | country                                                                                                | 9 domains incl. time use, community vitality                                         | domain design                                                                                        |
| Dubai Happiness Meter [42]               | per service touch                                                                                      | live satisfaction                                                                    | the "pulse" UX, not a metric to copy                                                                 |
| Santa Monica Wellbeing Index [54]        | city, 6 dimensions                                                                                     | survey + admin data                                                                  | **US municipal precedent**: 29 % feel they can influence decisions; ~40 % no neighbourhood belonging |
| California Healthy Places Index 3.0 [55] | census tract                                                                                           | 25 drivers of life expectancy (economy, education, transport, housing, environment…) | **tract-level, CA-native, free ArcGIS service**; already used in CA grant scoring                    |
| Opportunity Atlas [56]                   | tract                                                                                                  | adult outcomes of children by parent income                                          | the cleanest **socioeconomic mobility** layer                                                        |
| Tree Equity Score [57]                   | block group                                                                                            | canopy vs. need (heat, income, health)                                               | equity layer for trees/heat                                                                          |
| Gallup/Knight Soul of the Community [58] | 26 cities, 14k people                                                                                  | attachment drivers: **social offerings, openness, aesthetics, education**            | what actually makes people stay                                                                      |

### 4.2 Three kinds of "happy", and how each is collected

1. **Life evaluation** (0–10 ladder; WHR, UK ONS). Cheap survey, slow to move.
   This is the unit WELLBYs are built on [59].
2. **Experienced wellbeing**: momentary mood by place and time
   (experience sampling). Large Dutch studies show people are happier in
   natural settings [60][61]. This is how a _street_ change shows up first.
3. **Perceived environment**: safety, beauty, from street-view images +
   vision models (Place Pulse lineage; 2025–26 work on women's night safety,
   children's safety, VLM perception profiles) [62][63][64]. Good for
   screening; biased; never ground truth.

### 4.3 Across socioeconomic status

Averages hide the answer. The reliable pattern is **tract-level outcomes split
by income** (Opportunity Atlas [56], HPI [55], Tree Equity [57]) joined to the
project footprint. Any proposal scorecard should show the effect **per income
quintile**, plus who pays and who is displaced. Displacement risk is a cost
line, not a footnote.

---

## 5. The overlap: one ledger both sides already accept

The optimist wants happier, healthier people. The CFO wants a lower
long-run cost per resident and a higher tax base. They already share
currencies that governments use officially:

| Currency                                                                | Official use                       | Value                                                                  | Bridge                                                              |
| ----------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **WELLBY** (one point of life satisfaction for one person for one year) | UK HM Treasury Green Book          | **£15,920 per WELLBY (2024 prices)** [59]; child WELLBYs proposed [59] | wellbeing becomes a number finance staff accept                     |
| **Value of a statistical life + injury costs**                          | USDOT BCA guidance (May 2025) [65] | see guidance (exact 2025 figure not re-read)                           | CrashIQ already produces the crash side; HSIP/ATP grants need it    |
| **Per-km social values by mode**                                        | Danish Ministry of Finance         | bike +DKK 4.80/km, car −DKK 5.28/km [25]                               | DemandIQ mode-shift → money                                         |
| **Avoided public costs**                                                | Finland Housing First              | ~€15k/person/yr [29]                                                   | services ROI                                                        |
| **Health impact**                                                       | ISGlobal HIA                       | €1.7 bn/yr, 667 deaths (Barcelona, modelled) [28]                      | air/noise/heat/activity → deaths → money                            |
| **Infrastructure liability vs. tax value per acre**                     | Strong Towns / Urban3 [66]         | per-city                                                               | the bottom-line argument against low-value sprawl and road widening |
| **Loneliness cost**                                                     | health economics review            | US$2–25 bn/yr per country estimates [67]                               | social-offering investments                                         |
| **Retail sales on rebuilt streets**                                     | NYC DOT 2013 [68]                  | descriptive gains on 7 corridors                                       | business-district buy-in                                            |

**The proposal in one line:** every option on every street gets one scorecard:
_wellbeing gained (WELLBYs, by income quintile) · lives and injuries · public
cost now · lifecycle liability · tax value per acre · operations impact
(LOS/queues) · confidence tier_. That turns "be humane" and "protect the
budget" into the same ranking, with explicit trade-offs (the Singapore CLC
framing [33]) instead of two separate arguments.

Honest limits: WELLBY transfer from UK studies to a US street is an
assumption that must be shown as a modelled tier, not a measured one. The
overlap is strongest for safety, housing, trees/heat and active travel, and
weakest for culture and belonging, where evidence is thin.

---

## 6. Gaps and risks we must design around

- **Approval theatre.** A beautiful render is not a decision. The GEV
  four-state contract (#145) is the guard: nothing moves from Possible to
  Coordinated without the owning agency's own record.
- **Model numbers dressed as facts.** Keep TrafficOpsIQ's rule: AI writes
  inputs and prose; code computes numbers; every number shows its tier
  (measured / published-method / modelled / transferred).
- **Gamification abuse.** No points, leaderboards or reputation deciding civic
  outcomes (GEV #150 BLOCKED). The civ layer is a deliberation table, not a
  vote counter.
- **Surveillance creep.** Street-view perception and live sentiment drift
  toward tracking people. Aggregate only; carry GEV #143's
  anti-surveillance policy.
- **Data rights.** Caltrans CCTV commercial terms are unresolved; Nepal
  imagery is non-commercial. Check every layer's licence before a demo goes
  public.

## 7. Not verified

USDOT 2025 VSL figure (document not re-read); EIU full top 10 beyond the top
3; Pontevedra fatality count (snippet); Hangzhou City Brain (vendor claim);
aggregator rankings of planning software; Medellín causal effect (literature
disagrees).

## 8. Sources

[1] Frontiers in Sustainable Cities 2026, urban digital twinning as continuing practice. https://www.frontiersin.org/journals/sustainable-cities/articles/10.3389/frsc.2026.2011125/full
[2] UNDP, Digital Twins for Cities urban brief, July 2025. https://undp.org/sites/g/files/zskgke326/files/2025-08/digital_twins_for_cities_urban_brief_july_2025.pdf
[3] CEUS vol 128 (2026) 102449, agentic AI + urban digital twins + MCP. https://doi.org/10.1016/j.compenvurbsys.2026.102449
[4] Agentic Urban Digital Twins (AUDiTs), 2026. https://link.springer.com/article/10.1007/s44212-025-00099-3
[5] Zheng et al., Spatial planning of urban communities via deep RL, Nat Comput Sci 3 (2023). https://www.tsinghua.edu.cn/en/info/1245/12437.htm ; code https://github.com/tsinghua-fib-lab/DRL-urban-planning
[6] UrbanWorld. https://openreview.net/pdf?id=4W1wTg7q9o
[7] CityDreamer (CVPR 2024). https://www.scholar-inbox.com/paper/Xie2025ARXIV_Compositional_Generative_Model_of
[8] CityGPT. https://arxiv.org/html/2406.13948v1
[9] LLM-empowered participatory urban planning. https://arxiv.org/abs/2402.01698
[10] LiPUP-MA. https://arxiv.org/html/2412.20505v2
[11] ChatGPT-assisted planning support, Seoul (2025). https://doi.org/10.1080/12265934.2025.2462823
[12] Faculty, PlanAssist Beta. https://faculty.ai/en-gb/insights/news/were-working-with-planning-officers-to-build-an-agentic-ai-system-for-them
[13] GeekWire, Govstream.ai. https://www.geekwire.com/2025/seattle-area-startup-govstream-ai-raises-3-6m-to-improve-city-permitting-processes-using-ai/
[14] YC, Verdant. https://www.ycombinator.com/launches/RHI-verdant-helping-cities-process-permits-faster
[15] Xylo. https://pathfounders.com/p/attack-the-block-xylo-turns-up-to-hopefully-rescue-the-uk
[16] (aggregator) https://axiobench.com/best/3d-urban-planning-software
[17] OECD OPSI, Virtual Singapore. https://oecd-opsi.org/innovations/virtual-twin-singapore
[18] Helsinki 3D / HRI. https://www.hel.fi/en/decision-making/information-on-helsinki/maps-and-geospatial-data/helsinki-3d ; https://hri.fi/data/en_GB/dataset/helsingin-3d-kaupunkimalli
[19] CNN 2019, Alibaba City Brain. https://edition.cnn.com/2019/01/15/tech/alibaba-city-brain-hangzhou/index.html
[20] Woven by Toyota, 25 Sep 2025. https://woven.toyota/en/news/20250925/
[21] MIT CityScope. https://ira.mit.edu/blog/presidential-report
[22] Gehl & Svarre, How to Study Public Life. http://khoaquyhoach.hau.edu.vn/Cms_Data/Contents/Hau_DB/Media/Tailieu/Jan-Gehl-08-How-to-Study-Public-Life.pdf
[23] EIU Global Liveability Index 2026. https://economistgroup.com/press-centre/economist-enterprise/eiu-liveability-index-2026-copenhagen-vienna-and-melbourne-top-annual-city-ranking-with-new-york-recording-one-of-the-largest-score-gains
[24] Happy City Index 2026. https://happy-city-index.com/HCI_2025/ ; ranking https://happy-city-index.com/Total_Points
[25] CIVITAS Handshake, socio-economics of cycling. https://handshakecycling.eu/solutions/socio-economics
[26] Copenhagen Bicycle Account. https://urbandevelopmentcph.kk.dk/sites/default/files/2026-07/Bicycle%20Account%202018.pdf
[27] Guardian 2024; House Our Neighbors 2024. https://theguardian.com/lifeandstyle/2024/jan/10/the-social-housing-secret-how-vienna-became-the-worlds-most-livable-city ; https://houseourneighbors.org/2024-vienna-delegation
[28] ISGlobal press release, 9 Sep 2019; Elsevier award note. https://www.isglobal.org/documents/10179/7035461/NdP+Superilles+ENG/c17dc93b-d331-424f-8192-061181b8d327 ; https://www.isglobal.org/-/elsevier-distingue-un-estudio-de-isglobal-sobre-el-modelo-de-las-supermanzanas-de-barcelona
[29] World Habitat, Helsinki. https://world-habitat.org/blog/helsinki-is-still-leading-the-way-in-ending-homelessness-but-how-are-they-doing-it-2
[30] Renters Rising, Finland. https://renters-rising.org/social-housing-around-the-world/finland
[31] SG101, HDB Ethnic Integration Policy. https://www.sg101.gov.sg/society/examples/hdb/
[32] HDB. https://www.hdb.gov.sg/cs/infoweb/about-us/our-role/public-housing-a-singapore-icon
[33] CLC Liveability Framework. https://knowledgehub.clc.gov.sg/liveability-framework/overview
[34] Future Generations Wales, impact of the Act. https://futuregenerations.wales/explore/impact/impact-of-the-act
[35] Sustainable Safety (Springer 2022); EU ERSO Netherlands profile 2024. https://link.springer.com/rwe/10.1007/978-3-030-76505-7_12
[36] Politico, Pontevedra. https://www.politico.eu/article/pontevedra-city-pioneer-europe-car-free-future/
[37] Landscape Performance, Cheonggyecheon. https://landscapeperformance.org/case-study-briefs/cheonggyecheon-stream-restoration-project
[38] KSCE J Civ Eng, Cheonggyecheon CBA. https://link.springer.com/article/10.1007/s12205-015-0633-4
[39] Transp Res Procedia 2016, Medellín crime. https://doi.org/10.1016/j.trpro.2016.12.012
[40] Long-term view of Metrocable (2020). https://link.springer.com/10.1186/s42854-020-00008-8
[41] HUD PD&R, Tokyo. https://huduser.gov/portal/pdredge/pdr-edge-international-philanthropic-120324.html
[42] Digital Dubai, Happiness Meter. https://www.digitaldubai.ae/apps-services/details/happiness-meter
[43] OECD KEP, Bhutan GNH Index. https://www.oecd.org/en/publications/well-being-knowledge-exchange-platform-kep_93d45d63-en/bhutan-s-gross-national-happiness-gnh-index_ff75e0a9-en.html
[44] MPPN 2023, GNH 2022 results. https://www.mppn.org/beyond-gdp-bhutans-pursuit-of-wellbeing-and-happiness-revealed-in-latest-gnh-results
[45] Belfer Center, Estonia. https://belfercenter.org/publication/connected-digital-society-paving-ways-country-scale-digital-interoperability-estonia
[46] Gonçalves, PB and infant mortality in Brazil (World Development 2014). https://sciencedirect.com/science/article/abs/pii/S0305750X13000156
[47] IMD SCI 2026 methodology. https://www.imd.org/smart-city-observatory/home/methodology/
[48] IMD 2025 release. https://www.imd.org/news/competitiveness/worlds-smartest-cities-strike-very-different-balances-to-satisfy-citizen-needs-but-a-lack-of-affordable-housing-is-a-struggle-they-share/
[49] World Happiness Report. https://en.wikipedia.org/wiki/World_Happiness_Report
[50] OECD Regional Well-Being user guide. https://www.oecdregionalwellbeing.org/assets/downloads/Regional-Well-Being-User-Guide.pdf
[51] Social Progress Imperative, 10 Jun 2025. https://socialprogress.org/post/california-cities-lead-nation-quality-of-life
[52] WCCD ISO 37123; Toronto triple certification. https://www.dataforcities.org/iso-37123 ; https://www.toronto.ca/legdocs/mmis/2026/ex/bgrd/backgroundfile-284642.pdf
[53] UN-Habitat CPI metadata. https://unhabitat.org/sites/default/files/2019/02/CPI-METADATA.2016.pdf
[54] Santa Monica Wellbeing Index findings. https://santamonica.gov/press/2017/09/14/santa-monica-releases-new-findings-from-wellbeing-index
[55] California Healthy Places Index 3.0 technical report; ArcGIS service. https://files.healthyplacesindex.org/CA_HPI_3_Technical_Report_2022-09-20.pdf ; https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Healthy_Places_Index_3_0/FeatureServer/20
[56] Chetty et al., The Opportunity Atlas. https://census.gov/content/dam/Census/programs-surveys/center-for-economic-studies/opportunity_atlas_paper.pdf
[57] American Forests, Tree Equity Score. https://www.americanforests.org/project/tree-equity-score
[58] Gallup/Knight Soul of the Community. https://news.gallup.com/poll/144476/Social-Offerings-Openness-Key-Community-Attachment.aspx
[59] LSE CEP policy brief PA018 (WELLBY £15,920, 2024 prices; C-WELLBYs). https://cep.lse.ac.uk/pubs/download/pa018.pdf ; Nature HSSC 2024 https://www.nature.com/articles/s41599-024-03229-5
[60] Netherlands experience sampling (Landsc Urban Plan 2020). https://doi.org/10.1016/j.landurbplan.2020.103972
[61] MacKerron & Mourato, Mappiness (Glob Env Change 2013). https://doi.org/10.1016/j.gloenvcha.2013.03.010
[62] Stockholm AI safety-perception (BJC). https://academic.oup.com/bjc/article/66/2/265/8140796
[63] Children's street safety, Photovoice + ML (2025). https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2025.1666290/full
[64] VLM perception profiles (Land 2026). https://health.oregonstate.edu/research/publications/103390land15101919
[65] USDOT BCA Guidance, May 2025. https://www.transportation.gov/sites/dot.gov/files/2025-05/Benefit%20Cost%20Analysis%20Guidance%202025%20Update%20II%20%28Final%29.pdf
[66] Strong Towns / Urban3. https://archive.strongtowns.org/journal/2020/10/11/the-numbers-dont-lie
[67] Economic costs of loneliness review (2025). https://ncbi.nlm.nih.gov/pmc/articles/PMC12370830
[68] NYC DOT, Economic Benefits of Sustainable Streets (2013). https://www.nyc.gov/html/dot/html/pr2013/pr13-068.shtml
