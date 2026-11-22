#!/usr/bin/env python3
"""Arm (b) "AI postcard" TARGETS: edit a REAL app capture (the product's own
camera) toward the owner-chosen wintercats look. Targets only, never
candidates or approval; every output is labelled AI LOOK - NOT EVIDENCE in the
gallery, and the prompt forbids text/numbers in the pixels.

Route: ChatGPT subscription image_generation tool (same route as the old loop's
leanimg.py and comfyui-codex-image). Reads ~/.codex/auth.json; never prints it.

  postcard.py --capture-dir runs/r0/capture --out runs/r0/postcard \
      --ref bm-refs/2071919468054208604_hi.jpg --ref bm-refs/2072766293137092686_hi.jpg
"""
import argparse
import base64
import hashlib
import json
import pathlib
import ssl
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import concurrent.futures as cf

URL = "https://chatgpt.com/backend-api/codex/responses"
BEATS = ["district", "select", "reimagine", "build", "shadow", "growth"]
BEAT_NOTE = {
    "district": "a wide district view of the city blocks",
    "select": "one city plot is selected (the cyan outline / ring marks it): keep that plot clearly highlighted as a soft glowing game selection",
    "reimagine": "a proposal concept stands on the selected plot: keep it on the same plot as a cozy low-poly building/park proposal",
    "build": "a proposed building block stands on the selected plot: render it as a painterly low-poly building that belongs in the scene, same footprint and height",
    "shadow": "the proposed building on the plot casts a soft shadow; keep its footprint and shadow direction",
    "growth": "a district of plots with proposed blocks grows over time: render the proposed blocks as cozy low-poly buildings on the same plots",
}
PROMPT = """Edit image 1, a real screenshot of a 3D map app, into a stylised video-game look.
Images 2 and 3 are the STYLE reference (a cozy city-builder game): warm painterly palette with a colour grade,
soft global illumination and ambient occlusion, gentle bloom, tilt-shift depth of field (sharp middle band, soft top
and bottom), slightly simplified low-poly painterly forms for buildings and trees, soft warm key light.
Keep image 1's camera, framing, horizon and the real city layout (streets, blocks, park, building positions and
heights) exactly; this must still be the same place from the same viewpoint. Scene note: {note}.
Remove ALL user-interface overlays, panels, labels, icons and text; output only the stylised world.
Do NOT draw any text, numbers, logos, watermarks or UI. Output one image."""


def creds():
    auth = json.loads((pathlib.Path.home() / ".codex/auth.json").read_text())
    tok = auth["tokens"]["access_token"]
    claims = json.loads(base64.urlsafe_b64decode(tok.split(".")[1] + "=="))
    acct = claims.get("https://api.openai.com/auth", {}).get("chatgpt_account_id") or auth["tokens"].get("account_id")
    return tok, acct


def gen(prompt, images, size="1536x1024", model="gpt-6.2-sol", timeout=600):
    content = [{"type": "input_text", "text": prompt}] + [
        {"type": "input_image", "image_url": "data:image/jpeg;base64," + base64.b64encode(b).decode()} for b in images]
    body = json.dumps({
        "model": model,
        "instructions": "Use the image_generation tool exactly once to produce the requested image. Do not answer in text.",
        "input": [{"type": "message", "role": "user", "content": content}],
        "tools": [{"type": "image_generation", "size": size, "quality": "high", "output_format": "png"}],
        "tool_choice": "required", "stream": True, "store": False}).encode()
    tok, acct = creds()
    h = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json", "Accept": "text/event-stream",
         "originator": "codex_cli_rs", "User-Agent": "codex_cli_rs/0.153.4 (city-loop-postcard)"}
    if acct:
        h["ChatGPT-Account-ID"] = acct
    revised = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(URL, data=body, headers=h, method="POST"),
                                        timeout=timeout) as r:
                res = None
                for raw in r:
                    line = raw.decode("utf-8", "replace").strip()
                    if not line.startswith("data:"):
                        continue
                    try:
                        ev = json.loads(line[5:])
                    except ValueError:
                        continue
                    it = ev.get("item") or {}
                    if it.get("type") == "image_generation_call" and it.get("result"):
                        res = it["result"]
                        revised = it.get("revised_prompt")
                if res:
                    return base64.b64decode(res), revised
                raise RuntimeError("no image returned")
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"HTTP {e.code}: {e.read()[:200].decode('utf-8', 'replace')}") from None
        except (OSError, ssl.SSLError):
            if attempt == 2:
                raise
            time.sleep(3 * (attempt + 1))


def jpeg(path, tmp, edge=1536):
    out = pathlib.Path(tmp) / (pathlib.Path(path).stem + ".jpg")
    subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "85", "-Z", str(edge), str(path),
                    "--out", str(out)], capture_output=True, check=True)
    return out.read_bytes()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--capture-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--ref", action="append", required=True)
    ap.add_argument("--beats", default=",".join(BEATS))
    ap.add_argument("--model", default="gpt-6.2-sol")
    a = ap.parse_args()
    cap, out = pathlib.Path(a.capture_dir), pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    mf = out / "manifest.json"
    manifest = json.loads(mf.read_text()) if mf.exists() else {"kind": "AI LOOK - NOT EVIDENCE (target only)", "items": {}}
    with tempfile.TemporaryDirectory() as tmp:
        refs = [jpeg(r, tmp, 1280) for r in a.ref]

        def one(beat):
            src = cap / f"{beat}.png"
            dst = out / f"{beat}--postcard.png"
            if dst.exists() or not src.exists():
                return beat, None
            prompt = PROMPT.format(note=BEAT_NOTE[beat])
            t = time.time()
            try:
                png, revised = gen(prompt, [jpeg(src, tmp)] + refs, model=a.model)
            except Exception as e:
                return beat, {"error": str(e)[:300]}
            dst.write_bytes(png)
            return beat, {"file": dst.name, "sha256": hashlib.sha256(png).hexdigest(), "source": src.name,
                          "source_sha256": hashlib.sha256(src.read_bytes()).hexdigest(),
                          "refs": [pathlib.Path(r).name for r in a.ref], "model_route": f"chatgpt-subscription/{a.model}/image_generation",
                          "prompt": prompt, "revised_prompt": revised, "seconds": round(time.time() - t, 1)}

        with cf.ThreadPoolExecutor(max_workers=3) as ex:
            for beat, rec in ex.map(one, [b for b in a.beats.split(",") if b]):
                if rec:
                    manifest["items"][beat] = rec
                    mf.write_text(json.dumps(manifest, indent=1))
                print(beat, "skip" if rec is None else rec.get("error") or rec["file"], flush=True)


if __name__ == "__main__":
    main()
