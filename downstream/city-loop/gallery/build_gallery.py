#!/usr/bin/env python3
"""Owner gallery for one checkpoint: per beat CAPTURE | COZY FILTER (arm a) | AI POSTCARD TARGET (arm b) |
WINTERCATS REF, plus the compare wipe, journey MP4(s), panel scores and the one owner question.
Stdlib + sips (macOS) + ffmpeg only.

  build_gallery.py --round r0 --out DIR --beat-src beat=capture_dir[,..] --postcard DIR --ref A1.jpg --ref A2.jpg
      [--scores scores.json] [--calibration calibration.json] [--video file.mp4 ...] [--previous DIR]
"""
import argparse
import hashlib
import html
import json
import os
import shutil
import subprocess
from pathlib import Path

BEATS = ["district", "select", "reimagine", "build", "shadow", "growth"]
FFMPEG = os.environ.get("FFMPEG", shutil.which("ffmpeg") or "ffmpeg")
FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def to_jpg(src, dst, edge=1600, q=82):
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", str(q), "-Z", str(edge), str(src),
                    "--out", str(dst)], capture_output=True, check=True)
    return dst


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--beat-src", required=True, help="beat=dir pairs; '*=dir' default")
    ap.add_argument("--postcard", default="")
    ap.add_argument("--ref", action="append", default=[])
    ap.add_argument("--scores", default="")
    ap.add_argument("--calibration", default="")
    ap.add_argument("--video", action="append", default=[])
    ap.add_argument("--note", default="")
    a = ap.parse_args()
    out = Path(a.out)
    img = out / "img"
    img.mkdir(parents=True, exist_ok=True)
    src = {}
    for pair in a.beat_src.split(","):
        k, v = pair.split("=", 1)
        src[k] = Path(v)
    manifests = {}
    for d in set(src.values()):
        m = d / "manifest.json"
        if m.exists():
            manifests[str(d)] = json.loads(m.read_text())
    refs = [to_jpg(r, img / f"ref-{i}.jpg") for i, r in enumerate(a.ref)]
    scores = json.loads(Path(a.scores).read_text()) if a.scores and Path(a.scores).exists() else {}
    calib = json.loads(Path(a.calibration).read_text()) if a.calibration and Path(a.calibration).exists() else {}
    rows, sheet_cells, files = [], [], {}
    for b in BEATS:
        d = src.get(b) or src.get("*")
        man = manifests.get(str(d), {})
        cols = []
        cand = [("CAPTURE (photoreal, app)", d / f"{b}.png"),
                ("COZY FILTER (arm a, app)", d / f"{b}--cozy.png"),
                ("AI POSTCARD TARGET (arm b) · AI LOOK - NOT EVIDENCE", Path(a.postcard) / f"{b}--postcard.png" if a.postcard else None),
                ("WINTERCATS REF (A1/A2)", None)]
        for label, p in cand:
            if label.startswith("WINTERCATS"):
                r = refs[BEATS.index(b) % len(refs)] if refs else None
                cols.append((label, r.name if r else None))
                sheet_cells.append(r)
                continue
            if p and p.exists():
                j = to_jpg(p, img / f"{b}--{p.stem.split('--')[-1] if '--' in p.stem else 'capture'}.jpg")
                files[j.name] = {"source": str(p.name), "source_sha256": sha(p)}
                cols.append((label, j.name))
                sheet_cells.append(j)
            else:
                cols.append((label, None))
                sheet_cells.append(None)
        wipe = d / f"{b}--cozy-wipe.png"
        wipe_j = to_jpg(wipe, img / f"{b}--cozy-wipe.jpg") if wipe.exists() else None
        extra = ""
        if b == "growth":
            stages = [s for s in ("now", "5yr", "15yr") if (d / f"growth--stage-{s}.png").exists()]
            st = [to_jpg(d / f"growth--stage-{s}.png", img / f"growth--stage-{s}.jpg", 800) for s in stages]
            if st:
                extra = "<div class=stages>" + "".join(
                    f"<figure><img src='img/{p.name}'><figcaption>{s.upper()}</figcaption></figure>" for s, p in zip(stages, st)) + "</div>"
        beat_rec = man.get("beats", {}).get(b, {})
        sc = scores.get("beats", {}).get(b, {})
        sc_html = ""
        if sc:
            sc_html = "<table class=sc><tr><th>arm</th>" + "".join(f"<th>{k}</th>" for k in next(iter(sc.values())).keys()) + "</tr>" + "".join(
                f"<tr><td>{arm}</td>" + "".join(f"<td>{v}</td>" for v in m.values()) + "</tr>" for arm, m in sc.items()) + "</table>"
        rows.append(f"""<section><h2>{b.upper()} <small>app {html.escape(man.get('app', {}).get('sha', '?')[:9])} ·
 {html.escape(beat_rec.get('status', 'missing'))}{(' · ' + html.escape(beat_rec.get('error', ''))) if beat_rec.get('error') else ''}</small></h2>
<div class=row>""" + "".join(
            f"<figure><div class=lab>{html.escape(l)}</div>" + (f"<a href='img/{f}'><img src='img/{f}'></a>" if f else "<div class=miss>not captured</div>") + "</figure>"
            for l, f in cols) + "</div>" + (f"<p class=wipe>Original | Cozy compare wipe:</p><img class=wide src='img/{wipe_j.name}'>" if wipe_j else "") + extra + sc_html + "</section>")
    # Contact sheet: 6 rows x 4 cols at 480x300.
    W, H = 480, 300
    sheet = out / f"contact-sheet-{a.round}.jpg"
    inputs, filters = [], []
    for i, c in enumerate(sheet_cells):
        if c is None:
            inputs += ["-f", "lavfi", "-i", f"color=c=0x111418:s={W}x{H}:d=1"]
        else:
            inputs += ["-i", str(c)]
        filters.append(f"[{i}:v]scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x111418,setsar=1[c{i}]")
    n = len(sheet_cells)
    layout = "|".join(f"{(i % 4) * W}_{(i // 4) * H}" for i in range(n))
    heads = ["CAPTURE", "COZY FILTER (a)", "AI POSTCARD TARGET (b)", "WINTERCATS REF"]
    fc = ";".join(filters) + ";" + "".join(f"[c{i}]" for i in range(n)) + f"xstack=inputs={n}:layout={layout}:fill=0x111418[g]"
    fc += ";[g]pad=iw:ih+40:0:40:color=0x05080a" + "".join(
        f",drawtext=fontfile='{FONT}':text='{t}':x={k * W + 10}:y=12:fontsize=18:fontcolor=0x2EC8E8" for k, t in enumerate(heads))
    fc += "".join(f",drawtext=fontfile='{FONT}':text='{bb.upper()}':x=10:y={40 + r * H + H - 30}:fontsize=18:fontcolor=white:box=1:boxcolor=0x000000AA:boxborderw=5" for r, bb in enumerate(BEATS))
    fc += "[o]"
    r = subprocess.run([FFMPEG, "-y", "-loglevel", "error", *inputs, "-filter_complex", fc, "-map", "[o]", "-frames:v", "1", "-q:v", "4", str(sheet)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print("contact sheet failed:", r.stderr[-500:])
    vids = []
    for v in a.video:
        p = Path(v)
        if p.exists():
            shutil.copy(p, out / p.name)
            vids.append(p.name)
    cal_html = ""
    if calib:
        v = calib.get("verdict", {})
        cal_html = f"<pre>{html.escape(json.dumps(v, indent=1))}</pre>"
    tiles = "; ".join(f"{Path(k).name}: {m.get('tiles', {}).get('rendering')} (app {m.get('app', {}).get('sha', '')[:9]})" for k, m in manifests.items())
    page = f"""<!doctype html><meta charset=utf-8><title>GEV city loop v2 · {a.round}</title>
<style>body{{background:#05080a;color:#cfe9ef;font:14px ui-monospace,Menlo,monospace;margin:24px}}h1,h2{{letter-spacing:.18em;text-transform:uppercase;color:#2EC8E8}}
h2 small{{color:#7a9aa2;font-size:12px;letter-spacing:.05em}}.row{{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}}figure{{margin:0}}
img{{width:100%;border:1px solid #1c3b44}}.lab{{font-size:11px;letter-spacing:.12em;color:#2EC8E8;margin:4px 0}}.miss{{height:200px;border:1px dashed #33525a;display:grid;place-items:center;color:#557}}
.wide{{width:50%}}.stages{{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:75%}}section{{border-top:1px solid #12313a;padding:12px 0 24px}}
.q{{border:1px solid #2EC8E8;padding:12px;box-shadow:0 0 12px #2EC8E855}}table.sc{{border-collapse:collapse;margin-top:8px}}.sc td,.sc th{{border:1px solid #1c3b44;padding:3px 8px}}
.chip{{display:inline-block;border:1px solid #e8b42e;color:#e8b42e;padding:1px 6px;font-size:11px}}</style>
<h1>GEV city loop v2 · {a.round} · baseline</h1>
<p class=q><b>Kevin, one question:</b> ship, more of X, or stop? Reply with which arm (CAPTURE / COZY FILTER / AI POSTCARD look)
and which beat. Your verdict is recorded against the app SHA shown per beat. Critic scores below are advisory, not approval.</p>
<p>Tiles: {html.escape(tiles)}. <span class=chip>AI LOOK - NOT EVIDENCE</span> = the arm (b) postcards are image-model edits of the real
capture, targets only. {html.escape(a.note)}</p>
<p><a href='{sheet.name}'>contact sheet</a> · videos: {" · ".join(f"<a href='{v}'>{v}</a>" for v in vids)}</p>
{"".join(f"<video src='{v}' controls muted playsinline style='width:49%'></video>" for v in vids)}
{cal_html}
{"".join(rows)}
"""
    (out / "index.html").write_text(page)
    (out / "gallery-manifest.json").write_text(json.dumps({"round": a.round, "files": files, "videos": vids,
                                                           "contact_sheet": sheet.name}, indent=1))
    print(out / "index.html", sheet)


if __name__ == "__main__":
    main()
