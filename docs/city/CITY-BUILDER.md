# Create and compare possible worlds

1. Fly to a public place with Location search. Wait for the map to load.
2. Click **City builder** above the globe, or open **AUTHORING** and click **City builder**.
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
```

The gate uses Playwright and an owned headless Chromium profile. It checks real globe pixels, authoring, version restore, more than two alternatives, comparison, local persistence, JSON round-trip, malformed import, Scene entry, mobile layout, and no implicit generator calls. Set `CHROME_PATH` if Chromium is not at `/usr/bin/chromium`.

Add `--real` only when you intend to make one real local image request. Set `QA_SHOTS_DIR` to choose the evidence directory and `QA_VIDEO_DIR` to record the journey as video. The gate saves screenshots, source images, exported JSON, network diagnostics, and its assertion summary.

This feature reuses Kevin Rajan's planning and collaboration-authority work from fork PRs #291, #292, and #298. GEV's globe, Scene UI, and component kit retain their original contributors' authorship. It implements local proposal authoring and concept comparison, not the remaining multiplayer, surveyed geometry, accessibility-model, or civic-process requirements of #184.
