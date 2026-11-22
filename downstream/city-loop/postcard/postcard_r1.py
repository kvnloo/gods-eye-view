#!/usr/bin/env python3
"""Round-1 postcard TARGETS: painterly low-poly "wintercats" edits of the REAL round-0 captures.

Round 0's postcards read as a realistic tilt-shift miniature (owner-side read 2026-11-22), not the
painterly low-poly look Kevin chose. This version keeps the same route (postcard.gen, ChatGPT
subscription image_generation) and the same camera/place, but:
  * the style block asks for low-poly painterly forms explicitly (flat-shaded facets, chunky simplified
    buildings, rounded clumped trees, saturated greens/teals/warm oranges), not photo realism;
  * every beat carries the app's own countables, built from the massing/growth constants below, which
    mirror src/data/cityMassing.js (MASSING_ASSUMPTIONS) and src/data/cityGrowth.js (GROWTH_ASSUMPTIONS)
    at the round-0 capture SHA. A factual miss in the output rejects that image.
  * the select/reimagine notes describe the round-1 interaction intents (ground-draped footprint ghost;
    concept laid flat on the plot) so targets and candidates aim at the same thing.

  postcard_r1.py --capture-dir <round-0 capture dir> --out <dir> --ref A1.jpg --ref A2.jpg [--variants 2]
Targets only: every output is AI LOOK - NOT EVIDENCE and never a candidate or approval.
"""
import argparse
import concurrent.futures as cf
import hashlib
import json
import pathlib
import sys
import tempfile
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from postcard import gen, jpeg  # noqa: E402

# Mirrors of the app spec (checked against src/data/cityMassing.js and src/data/cityGrowth.js).
PLOT_M = 40
SETBACK_M = 4
STOREY_M = 3.2
BUILD_STOREYS = 6          # MASSING_ASSUMPTIONS.storeys (capture manifest beats.build.storeys = 6)
SHADOW_STOREYS = 3         # after FIT TO SUN (capture manifest beats.shadow.storeys = 3)
GROWTH_PLOTS = 25
GROWTH_COHORT = 12         # ceil(25 * 12/25)
GROWTH_STOREYS_15YR = (3, 5)  # base plots stay 3, the cohort reaches 5 at 15 YR
FOOT = PLOT_M - 2 * SETBACK_M


def spec():
    return {
        "plot_m": PLOT_M, "footprint_m": FOOT, "storey_m": STOREY_M,
        "build": {"storeys_incl_ground": BUILD_STOREYS, "height_m": round(BUILD_STOREYS * STOREY_M, 1), "roof": "flat"},
        "shadow": {"storeys_incl_ground": SHADOW_STOREYS, "height_m": round(SHADOW_STOREYS * STOREY_M, 1), "roof": "flat"},
        "growth_15yr": {"plots": GROWTH_PLOTS, "at_5_storeys": GROWTH_COHORT, "at_3_storeys": GROWTH_PLOTS - GROWTH_COHORT},
    }


def block(storeys):
    return (f"exactly {storeys} storeys counting the ground floor (ground floor + {storeys - 1} upper floors), "
            f"about {storeys * STOREY_M:.1f} m tall, flat roof, a square footprint of {FOOT} m x {FOOT} m centred on the "
            f"{PLOT_M} m x {PLOT_M} m plot with a {SETBACK_M} m margin of ground all round")


BEAT_NOTE = {
    "district": "a wide district view; keep the whole street grid, the bay, the piers and the downtown cluster where they are",
    "select": ("one city plot just right of the large central park is selected: mark it ONLY with a soft glowing cyan "
               "outline and a faint cyan tint draped flat on the ground of that square plot (a placement ghost lying "
               "on the ground, no box, no prism, no ring menu)"),
    "reimagine": ("a proposed pocket park is laid FLAT on the selected square plot: low clipped lawn, a few rounded "
                  "low-poly trees, paths and benches at ground level, natural colours (no green tint, no hologram, "
                  "nothing standing up like a card)"),
    "build": (f"a proposed new building stands on the selected plot: a cozy low-poly diorama building, {block(BUILD_STOREYS)}; "
              "warm plaster walls, simple window rows per storey, a few small trees in the margin; it must look like it "
              "belongs to the same game world as the restyled city"),
    "shadow": (f"the proposed building on the selected plot is {block(SHADOW_STOREYS)}; it casts a soft shadow to the "
               "north (toward the top of the frame) on the ground and neighbours; same cozy low-poly style"),
    "growth": (f"a district of {GROWTH_PLOTS} square plots (5 x 5) has grown proposed blocks: {GROWTH_COHORT} of them are "
               f"5 storeys and {GROWTH_PLOTS - GROWTH_COHORT} are 3 storeys, all flat roofed, rendered as cozy low-poly "
               "diorama buildings with warm roofs and small trees, sitting on their own plots within the real city"),
}

PROMPT = """Edit image 1 (a real screenshot of a 3D map of San Francisco) into a stylised cozy city-builder video game frame.
Images 2 and 3 are the STYLE reference only (never a source of geography or objects). Match THEIR look, not a photo:
- painterly LOW-POLY forms: buildings simplified to chunky clean blocks and gabled/flat roofs with flat-shaded facets and
  crisp edges, no photographic texture or noise; trees as rounded clumped low-poly canopies (pines and round trees);
- palette: saturated fresh greens and teal-cyan water, warm cream/terracotta/orange roofs and walls, soft lilac shadows;
  a colour-graded, slightly stylised look like a game LUT, never sepia or brown;
- light: soft warm key sun, soft global illumination and contact ambient occlusion, gentle bloom on bright surfaces;
- optics: tilt-shift depth of field (sharp middle band, softly blurred top and bottom), light haze far away.
Keep image 1's camera, framing, horizon, perspective and real city layout exactly (streets, blocks, parks, shoreline,
building positions and relative heights): the same place from the same viewpoint, only re-rendered in the game style.
Scene note: {note}.
Remove ALL user-interface overlays, panels, labels, icons, attribution and text; output only the stylised world.
Do NOT draw any text, numbers, logos, watermarks or UI. Output one image."""

STYLE_VARIANT = {
    "v1": "",
    "v2": "\nVariant emphasis: lean further into the stylised diorama look (cleaner flatter facets, fewer small details, richer greens).",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--capture-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--ref", action="append", required=True)
    ap.add_argument("--beats", default=",".join(BEAT_NOTE))
    ap.add_argument("--variants", default="v1,v2")
    ap.add_argument("--model", default="gpt-6.2-sol")
    a = ap.parse_args()
    cap, out = pathlib.Path(a.capture_dir), pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    mf = out / "manifest.json"
    manifest = json.loads(mf.read_text()) if mf.exists() else {
        "kind": "AI LOOK - NOT EVIDENCE (target only)", "round": "r1", "spec": spec(), "items": {}}
    jobs = [(b, v) for b in a.beats.split(",") if b for v in a.variants.split(",") if v]
    with tempfile.TemporaryDirectory() as tmp:
        refs = [jpeg(r, tmp, 1280) for r in a.ref]

        def one(job):
            beat, var = job
            src = cap / f"{beat}.png"
            dst = out / f"{beat}--postcard-{var}.png"
            if dst.exists() or not src.exists():
                return job, None
            prompt = PROMPT.format(note=BEAT_NOTE[beat]) + STYLE_VARIANT[var]
            t = time.time()
            try:
                png, revised = gen(prompt, [jpeg(src, tmp)] + refs, model=a.model)
            except Exception as e:
                return job, {"error": str(e)[:300]}
            dst.write_bytes(png)
            return job, {"file": dst.name, "sha256": hashlib.sha256(png).hexdigest(), "source": src.name,
                         "source_sha256": hashlib.sha256(src.read_bytes()).hexdigest(),
                         "refs": [pathlib.Path(r).name for r in a.ref],
                         "model_route": f"chatgpt-subscription/{a.model}/image_generation",
                         "prompt": prompt, "revised_prompt": revised, "seconds": round(time.time() - t, 1)}

        with cf.ThreadPoolExecutor(max_workers=3) as ex:
            for (beat, var), rec in ex.map(one, jobs):
                if rec:
                    manifest["items"][f"{beat}--{var}"] = rec
                    mf.write_text(json.dumps(manifest, indent=1))
                print(beat, var, "skip" if rec is None else rec.get("error") or rec["file"], flush=True)


if __name__ == "__main__":
    main()
