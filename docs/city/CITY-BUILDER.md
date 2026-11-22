# Create and compare possible worlds

## Play on the globe

1. Fly to a public place and wait for the map to load. Click **City builder** above the globe. The pill turns cyan, the side panels slide away and a resource bar appears. Its values come from your project, and it lists only the values the app has: it is empty until you have a project, and **Walk access** appears once the selected world has a walk-access site (choose one in **Project records**). A figure marked **EST** is an estimate for a possible world (a proposal's trees, shade and width, and their total and average in the bar), not a measurement; **~** marks an estimate rounded to two significant figures. Counts and 40 m grid areas are exact and carry no mark.
2. Click a plot of land. The app snaps the point to a 40 m grid cell, not a surveyed parcel, and outlines it on the map with an action wheel. A tag beside the wheel names the plot by its area (**Plot · 1,600 m²**); once the plot is reimagined, the tag on the concept reads the same. The app never shows a plot's internal grid code.
3. Click **Reimagine** (or **Park**, **Plaza** or **Bike lane**). The camera frames the plot, the app captures that view and the selected provider imagines it. The concept stands on the plot, base on the ground, with a dark contact band and a shadow cast away from the sun of the scene clock (length = card height / tan(sun elevation), capped at 2.5 times the height); the card face is shaded by the same sun. Photoreal tiles carry their own capture-time lighting, which no API exposes, so the shadow follows the scene clock rather than the imagery. The concept also appears as a card in the bottom carousel. It is labeled "AI concept, not a plan or an approval". The card also states what the world changes as a before → after, and the resource bar repeats it for the selected card: `CANOPY 18 → 60% EST` for a pocket park; a bike lane also shows `BIKE LANE 0 → 2.5 m EST`. The value before is an assumed baseline of the plan score (18% canopy, no bike lane), not a measurement of the plot; the value after is the plan's canopy with this world built (the proposal's shade on its plot and the baseline on every other plot of your project, weighted by land area, so a 60% park on one plot of two reads `18 → 39%`), or the bike lane's width. A world that changes neither shows no such figure.
4. **Reroll** saves a new version of the selected card with a new concept. When a Reimagine or Reroll lands, the action wheel closes so the concept leads; click the plot to bring the wheel back. The plot tag always sits beside the wheel, never across its buttons. **Build** keeps that world on the plot for this session. **Project records** opens the editor below, with export, import, history and comparison.
5. Zoom in for parameter callouts and a stats card that sits beside the plot on a leader line, or zoom out for district pins. Cards and the carousel never cover the map credits. Every play-mode label keeps at least 4.5:1 contrast on its glass even over a white roof, and capital-letter labels are at least 12 px. Press Esc or click the pill to leave the mode.

6. **Zone** on the wheel opens a proposed land-use menu (Housing, Mixed use, Civic, Open space, Clear, Back). The chosen use tints the plot on the map and saves in the project. A legend lists plots, land area and share of zoned area per use; every number is computed from the zoned 40 m cells, and changing a plot's use changes them at once. It is a hypothetical land use, not the city's zoning. Zoomed out, each reimagined or zoned plot has a badge with its use and the existing walk-access estimate (#206). Land use never recomputes walk access; play-mode worlds have no walk-access site, so their badge shows a dash.

Each reimagined plot keeps its own captured view; the first plot's capture also becomes the project baseline. The project still holds at most six alternatives.

After a reload, the first time you open play mode it frames your most recent concept again: the camera flies to that plot, the concept stands on it and its card opens in the carousel. It does this only when the plot is within 3 km of the camera (or twice the camera height), so opening the mode in another city never flies you away.

## Records editor

1. Fly to a public place with Location search. Wait for the map to load.
2. Open **AUTHORING** and click **City builder**, or click **City builder** above the globe and then **Project records**.
3. Enter a project title and click **Start from current view**. The app captures the Cesium canvas, camera, geographic bounds, time, and selected-map citation. It does not infer your location.
4. Enter an alternative title and description. Choose park, bike lane, or plaza and set the proposed tree count, width, and shade percentage. Click **Save possible world**.
5. Click **New alternative** and save another option. These parameters describe your proposal. They do not predict effects or establish feasibility.
6. Use **Edit** to save another version. Expand **Version history** to restore an earlier version as a new version. Stale edits fail rather than overwrite another revision.
7. Click **Imagine** on an alternative. The default Fixture provider returns a deterministic sample diagram without a network request. It is not an image of your site.
8. Choose a **Site** to place a park or plaza on the sample walking network, or leave it unplaced. Scroll to the comparison: **Walking access to the nearest park** estimates mean and worst-served walks on an offline synthetic network for the baseline and each alternative. Unplaced, off-network and bike-lane proposals show unknown, never zero. It is a hypothetical estimate, not a benefit claim. The comparison's reference-only baseline stays separate from proposals and concept images. **Game view** selects one alternative at a time. **Co-op view** shows all alternatives locally, not a shared room.
9. Click **Export project** to save the complete JSON document, including image provenance and version history. **Import project** validates the whole document before replacing the open project. Imported citations and recorded authorship remain unverified.

Successful changes save under `godsEyeView.cityBuilder.v1` in this browser's local storage. Reload restores them. If storage fails, the editor reports that changes are not saved and export remains available. An exclusive Web Locks lease permits only one tab to write this workspace. Other tabs can read and export but cannot overwrite it. Browsers without Web Locks also refuse persistence. Close the writer tab and reload the other tab to take over. Unreadable stored bytes remain untouched until an explicit valid import.

The current limits are six alternatives, twenty versions per alternative, 600,000 characters per embedded PNG or JPEG, and 4 MiB for the complete JSON document. Antimeridian-crossing or unavailable bounds cannot become a baseline. Start from another view instead.

Every concept says **AI concept, not a plan or an approval**. Its record includes the exact prompt, provider, time, and source view. Neither images nor proposals alter observed facts, approve construction, claim land rights, model impacts, control live traffic signals, or issue dispatch instructions.

## Generate a local AI concept

On the owner's configured machine, start the development server from the worktree root:

```sh
GEV_CITY_CONCEPT_LOCAL=1 HOST=127.0.0.1 npm run dev
```

Select **ChatGPT subscription via local bridge** in City builder, then press **Imagine** on a saved alternative. That button sends the project's captured globe image, description, parameters, and reference context through the local endpoint to ChatGPT. Generation does not stay on-device. The UI discloses this transfer before you press Imagine. Each version retains one concept; save a new version before generating another. Moving the globe afterward does not change the frozen project reference.

The endpoint runs `scripts/city-concept-server.py` under a clean environment. It reuses the installed `comfyui-codex-image` generator and the owner's existing ChatGPT subscription login. It accepts one loopback, same-origin request at a time. The bridge accepts no file paths or process arguments from the browser. Credentials never enter the client bundle or JSON export.

The endpoint exists only in the opted-in Vite development server, not production builds or preview. No request occurs on opening, editing, import, reload, or provider selection. Failures require another explicit button press. Closing the dialog cancels a pending result.

## Run the regression gate

Run the development server on an isolated loopback port, then:

```sh
QA_BASE_URL=http://127.0.0.1:4187 node scripts/qa-city-builder.mjs
QA_BASE_URL=http://127.0.0.1:4187 node scripts/qa-city-play.mjs
```

`qa-city-play.mjs` drives the play mode on the real globe: enter, plot click with the wheel within 40 px of the projected plot, Reimagine, Reroll, detail and district tiers, Esc, reload (the restored concept, its tag and card must be on screen and not covered by the HUD) and the 390x844 layout. At each step it audits every visible play-mode label (computed colour composited through its glass over white: 4.5:1 or better; caps at least 12 px) and checks that nothing covers the map credits. `src/testSupport/cityPersistenceFixture.mjs` is the one shared persistence fixture: an unplaced alternative, one placed on a walk-access site and one reimagined on a play-mode plot (rerolled once) go through the real builder's create, save, reload and reselect path (`src/data/cityPersistence.test.mjs`). `src/testSupport/cityDocumentSavedKeys.txt` pins every saved key as a sorted `path: type` line; a feature that adds a saved key must update that file on purpose.

The journey is one page session: it never reloads, so its recording has no loading splash midway. Restore is proven at the end in a fresh page of the same browser profile, after the journey page closes. With `QA_VIDEO_DIR` it records `journey.mp4` and `restore.mp4` (MP4 when ffmpeg is available).

The gate uses Playwright and an owned headless Chromium profile. It checks real globe pixels, authoring, version restore, more than two alternatives, comparison, local persistence, JSON round-trip, malformed import, Scene entry, mobile layout, and no implicit generator calls. Set `CHROME_PATH` if Chromium is not at `/usr/bin/chromium`.

Add `--real` only when you intend to make one real local image request. Set `QA_SHOTS_DIR` to choose the evidence directory and `QA_VIDEO_DIR` to record the journey as video. The gate saves screenshots, source images, exported JSON, network diagnostics, and its assertion summary.

This feature reuses Kevin Rajan's planning and collaboration-authority work from fork PRs #291, #292, and #298. GEV's globe, Scene UI, and component kit retain their original contributors' authorship. It implements local proposal authoring and concept comparison, not the remaining multiplayer, surveyed geometry, accessibility-model, or civic-process requirements of #184.
