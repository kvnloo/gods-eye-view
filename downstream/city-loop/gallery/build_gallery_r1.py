#!/usr/bin/env python3
"""Round-1 owner gallery: per beat TARGET (r1 postcard) | ROUND-0 | ROUND-1 (parent, same run conditions) |
ROUND-1 candidate LOOK | ROUND-1 candidate CLEAR | WINTERCATS REF, plus the journey MP4 and a contact sheet.
Stdlib + sips + ffmpeg (macOS).

  build_gallery_r1.py --out DIR --targets DIR(TARGET.json) --r0 DIR --parent DIR --cand DIR --ref A1 --ref A2
      [--video f.mp4] [--banner TEXT] [--panel panel.json] [--ledger rounds.jsonl]
Every candidate column states its manifest's tiles.rendering; anything but google-photoreal-3d-tiles is
labelled DIAGNOSTIC - INVALID FOR SCORING.
"""
import argparse
import hashlib
import html
import json
import shutil
import subprocess
from pathlib import Path

BEATS = ["district", "select", "reimagine", "build", "shadow", "growth"]
FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
HEADS = ["TARGET r1 (AI LOOK)", "ROUND-0 capture", "R1 PARENT", "R1 CANDIDATE LOOK", "R1 CANDIDATE CLEAR", "WINTERCATS REF"]


def jpg(src, dst, edge=1600, q=82):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.suffix.lower() in (".jpg", ".jpeg") and edge >= 1600:
        shutil.copy(src, dst)
    else:
        subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", str(q), "-Z", str(edge), str(src),
                        "--out", str(dst)], capture_output=True, check=True)
    return dst


def find(d, stem):
    for ext in (".png", ".jpg"):
        p = Path(d) / f"{stem}{ext}"
        if p.exists():
            return p
    return None


def rendering(d):
    m = Path(d) / "manifest.json"
    if not m.exists():
        return "unknown", "?"
    j = json.loads(m.read_text())
    return j.get("tiles", {}).get("rendering", "unknown"), j.get("app", {}).get("sha", "?")[:9]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--targets", required=True)
    ap.add_argument("--r0", required=True)
    ap.add_argument("--parent", required=True)
    ap.add_argument("--cand", required=True)
    ap.add_argument("--ref", action="append", default=[])
    ap.add_argument("--video", action="append", default=[])
    ap.add_argument("--banner", default="")
    ap.add_argument("--panel", default="")
    ap.add_argument("--notes", default="")
    a = ap.parse_args()
    out = Path(a.out)
    img = out / "img"
    img.mkdir(parents=True, exist_ok=True)
    T = json.loads((Path(a.targets) / "TARGET.json").read_text())
    refs = [jpg(Path(r), img / f"ref-{i}.jpg") for i, r in enumerate(a.ref)]
    r0_tiles, r0_sha = rendering(a.r0)
    p_tiles, p_sha = rendering(a.parent)
    c_tiles, c_sha = rendering(a.cand)
    notes = json.loads(Path(a.notes).read_text()) if a.notes and Path(a.notes).exists() else {}
    panel = json.loads(Path(a.panel).read_text()) if a.panel and Path(a.panel).exists() else {}

    def tag(t):
        return "" if t == "google-photoreal-3d-tiles" else " · DIAGNOSTIC - INVALID FOR SCORING"

    labels = [f"TARGET r1 · AI LOOK - NOT EVIDENCE",
              f"ROUND-0 · app {r0_sha} · {r0_tiles}",
              f"R1 PARENT · app {p_sha} · {p_tiles}{tag(p_tiles)}",
              f"R1 CANDIDATE LOOK (?look=cozy chain) · app {c_sha} · {c_tiles}{tag(c_tiles)}",
              f"R1 CANDIDATE CLEAR (?cityR1=all) · app {c_sha} · {c_tiles}{tag(c_tiles)}",
              "WINTERCATS REF (A1/A2, frozen)"]
    rows, cells, files = [], [], {}
    for bi, b in enumerate(BEATS):
        srcs = [Path(a.targets) / T["targets"][b]["file"], find(a.r0, b), find(a.parent, b),
                find(a.cand, f"{b}--cozy"), find(a.cand, b), refs[bi % len(refs)] if refs else None]
        names = []
        for ci, s in enumerate(srcs):
            if s is None or not Path(s).exists():
                names.append(None)
                cells.append(None)
                continue
            d = img / f"{b}--c{ci}.jpg"
            if ci < 5:
                jpg(Path(s), d)
                files[d.name] = {"source": str(s), "sha256": hashlib.sha256(Path(s).read_bytes()).hexdigest()}
            else:
                d = Path(s)
            names.append(d.name)
            cells.append(d)
        n = notes.get(b, {})
        pn = panel.get(b)
        extra = ""
        if n:
            extra += "<ul class=notes>" + "".join(f"<li><b>{html.escape(k)}</b>: {html.escape(str(v))}</li>" for k, v in n.items()) + "</ul>"
        if pn:
            extra += f"<pre class=panel>{html.escape(json.dumps(pn, indent=1))}</pre>"
        rows.append(f"<section><h2>{b.upper()}</h2><div class=row>" + "".join(
            f"<figure><div class=lab>{html.escape(l)}</div>" + (f"<a href='img/{f}'><img src='img/{f}' loading=lazy></a>" if f else "<div class=miss>missing</div>") + "</figure>"
            for l, f in zip(labels, names)) + f"</div>{extra}</section>")
    W, H = 400, 250
    sheet = out / "contact-sheet-r1.jpg"
    inputs, filt = [], []
    for i, c in enumerate(cells):
        inputs += (["-f", "lavfi", "-i", f"color=c=0x111418:s={W}x{H}:d=1"] if c is None else ["-i", str(c)])
        filt.append(f"[{i}:v]scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x111418,setsar=1[c{i}]")
    n = len(cells)
    layout = "|".join(f"{(i % 6) * W}_{(i // 6) * H}" for i in range(n))
    fc = ";".join(filt) + ";" + "".join(f"[c{i}]" for i in range(n)) + f"xstack=inputs={n}:layout={layout}:fill=0x111418[g]"
    fc += ";[g]pad=iw:ih+36:0:36:color=0x05080a" + "".join(
        f",drawtext=fontfile='{FONT}':text='{t}':x={k * W + 8}:y=10:fontsize=15:fontcolor=0x2EC8E8" for k, t in enumerate(HEADS))
    fc += "".join(f",drawtext=fontfile='{FONT}':text='{bb.upper()}':x=8:y={36 + r * H + H - 28}:fontsize=16:fontcolor=white:box=1:boxcolor=0x000000AA:boxborderw=4" for r, bb in enumerate(BEATS))
    if c_tiles != "google-photoreal-3d-tiles":
        safe = c_tiles.replace(":", " ")
        fc += f",drawtext=fontfile='{FONT}':text='R1 COLUMNS 3-5 = DIAGNOSTIC (keyless {safe}) - NOT PROMOTION EVIDENCE':x={2 * W + 8}:y=h-24:fontsize=15:fontcolor=0xffb454:box=1:boxcolor=0x000000CC:boxborderw=4"
    fc += "[o]"
    r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", fc, "-map", "[o]", "-frames:v", "1", "-q:v", "4", str(sheet)],
                       capture_output=True, text=True)
    if r.returncode:
        print("contact sheet failed:", r.stderr[-1500:])
    vids = []
    for v in a.video:
        p = Path(v)
        if p.exists():
            shutil.copy(p, out / p.name)
            vids.append(p.name)
    page = f"""<!doctype html><meta charset=utf-8><title>GEV city loop v2 · round 1</title>
<style>body{{background:#05080a;color:#cfe9ef;font:14px ui-monospace,Menlo,monospace;margin:24px}}h1,h2{{letter-spacing:.18em;text-transform:uppercase;color:#2EC8E8}}
.row{{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}}figure{{margin:0}}img{{width:100%;border:1px solid #1c3b44}}
.lab{{font-size:10px;letter-spacing:.08em;color:#2EC8E8;margin:4px 0;min-height:2.6em}}.miss{{height:160px;border:1px dashed #33525a;display:grid;place-items:center;color:#557}}
section{{border-top:1px solid #12313a;padding:12px 0 22px}}.q{{border:1px solid #2EC8E8;padding:12px;box-shadow:0 0 12px #2EC8E855}}
.warn{{border:1px solid #ffb454;color:#ffb454;padding:10px}}.notes{{color:#9fc3cb}}pre.panel{{color:#9fc3cb;font-size:11px}}</style>
<h1>GEV city loop v2 · round 1 · checkpoint</h1>
<p class=q><b>Kevin, one question:</b> ship, more of X, or stop? Say which column (TARGET look / R1 look) and which beat.
Critic output is advisory, never approval. TARGET column = AI LOOK - NOT EVIDENCE.</p>
{f"<p class=warn>{html.escape(a.banner)}</p>" if a.banner else ""}
<p><a href='{sheet.name}'>contact sheet</a> · {" · ".join(f"<a href='{v}'>{v}</a>" for v in vids)}</p>
{"".join(f"<video src='{v}' controls muted playsinline style='width:60%'></video>" for v in vids)}
{"".join(rows)}"""
    (out / "index.html").write_text(page)
    (out / "gallery-manifest.json").write_text(json.dumps({"round": "r1", "files": files, "videos": vids, "contact_sheet": sheet.name,
                                                           "tiles": {"r0": r0_tiles, "parent": p_tiles, "candidate": c_tiles}}, indent=1))
    print(out / "index.html", sheet)


if __name__ == "__main__":
    main()
