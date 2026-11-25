# GEV phone shell v2 — one sheet, one floating element

Owner ask (Kevin, on the PR #336 phone build): "yikes bro this looks so bad". Target: make the GEV phone layout as calm
as Sound Atlas (glide-music-picker.vercel.app; `kvnloo/fframestudio` `web/src/music-atlas/style.css` @ `01eb90c`).
Scope: phone layout only (`body.mobile-shell`, ≤720 px). Desktop is untouched. Nothing is deleted; controls only move.

## 1. Diagnosis (verified on `feat/cast-mobile` @ `f6d7682`, 390×844 @3, shots in `shots/r00/`)

The parent's list was checked against the live DOM (`tools/shoot.mjs` inventory, `tools/probe.mjs`):

| Claim | Verified? | What is actually there |
|---|---|---|
| Neon logo top-left | yes | `#title-bar` 58×39 eye logo with a 200×80 `.title-glow` |
| Row of 5–6 round grey icon buttons at the top | **moved already** | PR #336 moved `#top-center-actions` (5 round 44 px buttons) to the thumb zone, y≈596, right-aligned |
| Right rail of 3 neon-cyan square buttons | yes | `#corner-actions` (`#key-setup-chip` ⚡, locale 🌐) + `#hStories` ▶, 44 px, cyan glow borders |
| Floating search bar | not on phone home | Search is a tab; the floating bar shows only in the themed/8801 build (older shell) |
| Voice/chat dock pill above the tab bar | yes | `#gev-voice-control` 280×85 pod: mic, waveform, page dots, chat, cyan border |
| 6-tab bar | yes | `#mobile-tab-bar` Layers · Cameras · Context · Search · Cast · More (64×57 each) |
| Cesium/Google/Data attribution across the middle | yes | `#cesium-credits` wraps to 2 lines at y≈647–680, scale 0.8, mono underlined links |
| "GEV Stories NEW" popup over half the screen | yes (first visit) | `#hPop`, plus the "Choose your first view" first-run launcher (`?welcome=0` hides it) |

Count: **five chrome systems** on home (logo+glow, corner rail, globe-actions row, voice pod, tab bar) plus the credit
block — each with its own radius (8/10/16/18/50 %), border (cyan glow, grey, none), type (mono caps 7.7–11 px, sans 10 px)
and fill. Sound Atlas has **one** sheet: grab handle, search, player row, segmented views, chips; one type scale, one
radius family, one accent; the visual owns the top ~70 %.

## 2. Control inventory → new home

Frequency is an estimate from the product's purpose (voice/agent-driven Earth twin) and the existing phone tab order;
there is no phone analytics to cite.

| # | Control (id) | Does | Use | v1 (now) | v2 home |
|---|---|---|---|---|---|
| 1 | Search (`data-mobile-sheet=search` → `#location-search`) | find a place | high | tab 4 of 6 | **Sheet row 1**: full-width search pill (SA `.search`, 46 px) |
| 2 | Voice (`#gev-voice-button`) | talk to the map | high | pod left | **Sheet row 2** (player row): 48 px round accent button, SA `.ib.pp` |
| 3 | Voice status / visualiser | live state | — | pod centre | Player row centre, quiet two-line text + waveform |
| 4 | Chat (`#gev-chat-button`) | open AI chat | high | pod right | Player row, 44 px quiet icon |
| 5 | Stories (`#hStories`) | curated views | medium | right rail, neon | Player row, 44 px quiet icon |
| 6 | Cast (`data-mobile-action=cast`) | play on a TV | medium | tab 5 | Player row, 44 px quiet icon (accent while casting) |
| 7–10 | Layers · Cameras · Context · More | open a panel sheet | high | tabs | **Sheet row 3**: a full-width native tab bar (icon over label, accent marks the open panel). Round 1–5 used SA's segmented `.views`; judges rated the tab bar more native (round 6) |
| 11–15 | Clear layers · Share · Tilt · North · Reset globe (`#top-center-actions`) | map view tools | medium | 5 loose round buttons | **The one floating element**: a single joined pill riding the sheet's top-right edge. Tilt/North/Reset visible; Clear and Share one tap behind the pill's `#mobile-tools-toggle` (round 5) |
| 16 | Power up keys (`#key-setup-chip`, dev only) | key setup | rare | right rail | Top bar status pill (SA "1 here" pill) |
| 17 | Language (`.locale-picker-button`) | UI language | rare | right rail | Same top pill, second half |
| 18 | Logo (`#title-bar`) | brand | — | 58 px + glow | Top-left, 40 px, no glow (SA `.brand`) |
| 19 | Map credits (`#cesium-credits`) | licence | legal | 2 wrapped lines mid-map | **One line** riding the sheet's top-left edge, 10 px, 70 % ink |
| 20 | Grab handle (`#mobile-sheet-grab`) | resize sheet | medium | only with a sheet | Top of the sheet, always drawn (decorative while closed) |
| 21 | Stories first-visit card (`#hPop`) | announce Stories | once | top half, 342×290 | Compact card docked above the sheet |

Nothing is removed: every id above stays in the DOM with its handler; v2 is CSS placement + the tab-bar component.

## 3. Sheet states (3 heights) and density

- **Closed / peek** (home): handle · search pill · player row · segmented tabs. ~194 px + safe area (23 % of 844).
- **Half** (a tab or search opened): the panel rises above the tab bar as the top of the same sheet (grab handle on
  its top edge); the tab bar stays at the bottom in thumb reach; search and player rows step aside (SA "density
  follows the sheet"). Panel cards lose their own frames inside the sheet.
- **Cast**: one action sheet over the home sheet (round 3 tried it above the tabs; rejected by both OpenAI seats).
- **Full**: handle drag/tap, sheet to `100dvh − 64 px − top inset`.
Swipe-down / Escape / tapping the active tab closes back to peek. Existing snap/fling/rubber-band JS is kept.

## 4. Tokens

Neutrals and geometry come from Sound Atlas `style.css:1-6,60-73,96-102`; warm ink and the bronze/gold set come from the
11-23 HUD palette (`loop-v2/round-v5/ui-loop/THEME.md` §1–2). Owner decision 11-23: the bronze/gold tokens are scoped to
city mode, the globe keeps GEV cyan — so the shell reads `--accent` and switches surface/line to the A2 set under
`.city-play`, instead of hard-coding either.

| Token | Default (globe) | `.city-play` (A2 bronze/gold) | Source |
|---|---|---|---|
| `--ms-surface` | `rgba(19,23,24,.94)` | `rgba(30,27,20,.94)` | SA `--panel2 #151a1b`; A2 `--glass-bg` |
| `--ms-field` | `rgba(255,255,255,.05)` | `rgba(255,236,200,.05)` | SA `.views` fill |
| `--ms-line` | `rgba(255,255,255,.09)` | `rgba(176,142,88,.40)` | SA `--line2`; A2 `--glass-border` |
| `--ms-ink` | `#ece8df` | `#f3ecdb` | SA `--ink`; A2 `--text-primary` |
| `--ms-mute` | `#8f8a80` → `#a39e94` (AA on surface) | `rgba(243,236,219,.72)` | SA `--mute` |
| `--ms-accent` | `var(--accent)` (GEV `#00d4ff`) | `var(--accent)` (`#e2b866`) | one accent |
| radius | sheet 22 · field 14 · segment 13/10 · icon 12 · primary 50 % | same | SA `.sheet`, `.search`, `.views`, `.ib` |
| type | 16 px field · 13/600 labels · 11 px status · 10 px credits | same | SA `.search input`, `.views button`, `.brand small` |
| spacing | 12 px side padding · 8–10 px row gaps | same | SA `.dock`, `.player` |
| targets | ≥ 44 px (SA's 28–40 px sizes are **not** ported) | same | port map "Do not port" |
| glow | none on chrome; accent only on the primary button and the active segment | same | A2 "glows are softer" |

## 5. Gates (every round)

≥ 44 px targets (credits links excepted, as on v1) · bottom-40 % share ≥ 84 % · axe serious/critical ≤ v1 per state ·
every control in §2 reachable · desktop unchanged (1440×900 screenshot diff of the shell area) · unit suite: no new
failures vs staging (2 known: camera traces, pose). Judges: two vendors, blind A/B with both seat orders, against the
Sound Atlas reference, question: "which reads as calmer, more polished, more native, and makes the most-used actions
easiest to reach".
