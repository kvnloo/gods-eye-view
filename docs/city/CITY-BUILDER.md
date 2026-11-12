# Create and compare possible worlds

1. Fly to a public place with Location search. Wait for the map to load.
2. Click **City builder** above the globe, or open **AUTHORING** and click **City builder**.
3. Enter a project title and click **Start from current view**. The app captures the Cesium canvas, camera, geographic bounds, time, and selected-map citation. It does not infer your location.
4. Enter an alternative title and description. Choose park, bike lane, or plaza and set the proposed tree count, width, and shade percentage. For a park or plaza, choose a **Site** to compare walking access. Click **Save possible world**.
5. Click **New alternative** and save another option. These parameters describe your proposal. They do not predict effects or establish feasibility.
6. Use **Edit** to save another version. Expand **Version history** to restore an earlier version as a new version. Stale edits fail rather than overwrite another revision.
7. Click **Imagine** on an alternative. The default Fixture provider returns a deterministic sample diagram without a network request. It is not an image of your site.
8. Scroll to the comparison. The reference-only baseline stays separate from proposals and concept images. **Game view** selects one alternative at a time. **Co-op view** shows all alternatives locally, not a shared room.
9. Click **Export project** to save the complete JSON document, including image provenance and version history. **Import project** validates the whole document before replacing the open project. Imported citations and recorded authorship remain unverified.

Successful changes save under `godsEyeView.cityBuilder.v1` in this browser's local storage. Reload restores them. If storage fails, the editor reports that changes are not saved and export remains available. An exclusive Web Locks lease permits only one tab to write this workspace. Other tabs can read and export but cannot overwrite it. Browsers without Web Locks also refuse persistence. Close the writer tab and reload the other tab to take over. Unreadable stored bytes remain untouched until an explicit valid import.

The current limits are six alternatives, twenty versions per alternative, 600,000 characters per embedded PNG or JPEG, and 4 MiB for the complete JSON document. Antimeridian-crossing or unavailable bounds cannot become a baseline. Start from another view instead.

## Compare walking access

The comparison opens with **Walking access to the nearest park**, labeled **HYPOTHETICAL ESTIMATE · NOT A BENEFIT CLAIM**. It has one row for the reference baseline and one for every alternative:

- **Mean walk** and **Worst-served walk** are shortest network walking distances from each of nine demand zones to its nearest park. The baseline counts only the existing park. A park or plaza alternative adds a park at its chosen site.
- The range in brackets comes from snapping each zone to its nearest network node or to a node one edge away.
- **Zones known** counts zones with a walking path to a park. A disconnected or off-network zone stays unknown. It is never counted as zero.
- **Change from baseline** subtracts the baseline mean and worst-served distance.
- An alternative without a site says **Unknown: choose a site**. A bike lane says **Not applicable**.

A schematic under the table shows the network, each zone's distance in metres, the existing park in green, and the proposed site in gold. Edit an alternative and choose another site to save a new version and see the change. Version history keeps every earlier site.

The network is an offline synthetic sample (`walk-access-fixture-v1`): a four-by-four street grid with a rail line, a plaza footpath and four candidate sites. It is not the streets at the captured place and contains no OpenStreetMap data. Demand weights are uniform because no sourced demand data exists. The estimate is calculated for display and never saved. The project file stores only the chosen site. Estimates change no concept image, baseline reference, or observed fact.

## Generate a local AI concept

On the owner's configured machine, start the development server from the worktree root:

```sh
GEV_CITY_CONCEPT_LOCAL=1 HOST=127.0.0.1 npm run dev
```

Select **ChatGPT subscription via local bridge** in City builder, then press **Imagine** on a saved alternative. That button sends the project's captured globe image, description, parameters, and reference context through the local endpoint to ChatGPT. Generation does not stay on-device. The UI discloses this transfer before you press Imagine. Each version retains one concept; save a new version before generating another. Moving the globe afterward does not change the frozen project reference.

The endpoint runs `scripts/city-concept-server.py` under a clean environment. It reuses the installed `comfyui-codex-image` generator and the owner's existing ChatGPT subscription login. It accepts one loopback, same-origin request at a time. The bridge accepts no file paths or process arguments from the browser. Credentials never enter the client bundle or JSON export.

The endpoint exists only in the opted-in Vite development server, not production builds or preview. No request occurs on opening, editing, import, reload, or provider selection. Failures require another explicit button press. Closing the dialog cancels a pending result.

Every image says **AI concept, not a plan or an approval**. Its record includes the exact prompt, provider, time, and source view. Neither images nor proposals alter observed facts, approve construction, claim land rights, model impacts, control live traffic signals, or issue dispatch instructions.

## Run the regression gate

Run the development server on an isolated loopback port, then:

```sh
QA_BASE_URL=http://127.0.0.1:4187 node scripts/qa-city-builder.mjs
```

The gate uses Playwright and an owned headless Chromium profile. It checks real globe pixels, authoring, version restore, more than two alternatives, comparison, local persistence, JSON round-trip, malformed import, Scene entry, mobile layout, and no implicit generator calls. Set `CHROME_PATH` if Chromium is not at `/usr/bin/chromium`.

For the walk-access journey, run `QA_BASE_URL=http://127.0.0.1:4187 node scripts/qa-city-access.mjs` against the same server. It uses Puppeteer and headless Chromium, saves numbered screenshots and an MP4 screencast to `QA_SHOTS_DIR` (default `qa-shots/city-access`), and needs `ffmpeg` on the path.

Add `--real` only when you intend to make one real local image request. Set `QA_SHOTS_DIR` to choose the evidence directory. The gate saves screenshots, source images, exported JSON, network diagnostics, and its assertion summary.

This feature reuses Kevin Rajan's planning and collaboration-authority work from fork PRs #291, #292, and #298. GEV's globe, Scene UI, and component kit retain their original contributors' authorship. It implements local proposal authoring, concept comparison, and a synthetic walking-access comparison (#206), not the remaining multiplayer, surveyed geometry, real-network accessibility, or civic-process requirements of #184.
