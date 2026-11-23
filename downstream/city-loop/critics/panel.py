#!/usr/bin/env python3
"""City loop v2 critic panel: >=3 judges (>=1 non-Claude), frozen rubric,
absolute 1-5 scores and both-order pairwise verdicts. Stdlib only.

Judges (see JUDGES): codex gpt-6.2-sol (non-Claude, images via -i), Claude
sonnet and Claude opus through advisor-lane (images via the Read tool).

  panel.py vision-check --out DIR --image KNOWN.png --expect word1,word2
  panel.py absolute --out DIR --items items.json      # [{"id","image","context"}]
  panel.py pairwise --out DIR --pairs pairs.json      # [{"id","a","b","context","layers"?}]

Every raw judge reply is kept in DIR/raw/*.json; results are cached by a hash
of (judge, task), so re-running only fills missing calls. Judges are rankers,
not rulers: nothing here writes owner approval.
"""
import argparse
import concurrent.futures as cf
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUBRIC_PATH = HERE / "rubric.json"
RUBRIC = json.loads(RUBRIC_PATH.read_text())
RUBRIC_SHA = hashlib.sha256(RUBRIC_PATH.read_bytes()).hexdigest()
LAYERS = list(RUBRIC["layers"])
ADVISOR = os.environ.get("ADVISOR_LANE", "/workspace/repos/home/tools/advisor-lane")
ADVISOR_ENV = {
    "ADVISOR_SLOT_ROOT": os.environ.get(
        "ADVISOR_SLOT_ROOT", os.path.expanduser("~/.advisor-slots")),
    "ADVISOR_SEATS": os.environ.get("ADVISOR_SEATS", "claude2 claude3"),
}
sys.path.insert(0, str(Path(__file__).resolve().parent))
from judge_gate import require as _gate  # noqa: E402

JUDGES = {
    "codex-gpt-6.2-sol": {"kind": "codex", "model": "gpt-6.2-sol", "family": "openai"},
    "claude-sonnet": {"kind": "claude", "model": "sonnet", "family": "anthropic"},
    "claude-opus": {"kind": "claude", "model": "opus", "family": "anthropic"},
}
CONCURRENCY = {"codex": 3, "claude": 2}


def prep_image(path, tmpdir):
    """Downscale to <=1600 px long edge JPEG with sips (macOS) so every judge sees the same pixels."""
    # exp/city-loop-v4: no judge sees a frame that may show Google tiles (judge_gate.py)
    _gate(path)
    src = Path(path)
    out = Path(tmpdir).resolve() / (hashlib.sha256(src.read_bytes()).hexdigest()[:16] + ".jpg")
    if not out.exists():
        r = subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "88",
                            "-Z", "1600", str(src), "--out", str(out)], capture_output=True)
        if r.returncode != 0 or not out.exists():
            shutil.copy(src, out)
    return str(out)


def rubric_text(layers):
    lines = []
    for k in layers:
        v = RUBRIC["layers"][k]
        lines.append(f"- {k}: {v['question']} (1 = {v['1']}; 3 = {v['3']}; 5 = {v['5']})")
    return "\n".join(lines)


def extract_json(text):
    text = text.strip()
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    if m:
        text = m.group(1)
    else:
        a, b = text.find("{"), text.rfind("}")
        if a >= 0 and b > a:
            text = text[a:b + 1]
    return json.loads(text)


def call_codex(model, prompt, images, timeout=900):
    base = Path(os.environ.get("PANEL_CODEX_TMP", Path.home() / ".hermes/profiles/tek/cache/scratch/panel-codex"))
    base.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=str(base)) as td:
        td = str(Path(td).resolve())
        last = Path(td) / "last.txt"
        cmd = ["codex", "exec", "-m", model, "--skip-git-repo-check", "-s", "read-only",
               "--output-last-message", str(last)]
        for im in images:
            cmd += ["-i", im]
        cmd += ["--", prompt]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=td,
                           stdin=subprocess.DEVNULL)
        text = last.read_text() if last.exists() else ""
        return {"text": text, "rc": r.returncode, "stderr_tail": r.stderr[-400:], "model_reported": model}


def call_claude(model, prompt, images, timeout=900):
    full = prompt + "\n\nUse the Read tool to view each image file before answering:\n" + "\n".join(
        f"- image {chr(65 + i) if len(images) > 1 else ''}: {p}" for i, p in enumerate(images))
    full += "\nDo not consult the advisor for this task. Reply with the JSON only."
    env = {**os.environ, **ADVISOR_ENV}
    r = subprocess.run([ADVISOR, "--model", model, "--allowedTools", "Read", "--timeout", str(timeout)],
                       input=full, capture_output=True, text=True, timeout=timeout + 400, env=env)
    out = {"rc": r.returncode, "stderr_tail": r.stderr[-300:], "text": ""}
    try:
        j = json.loads(r.stdout)
        out["text"] = j.get("result", "")
        out["model_reported"] = sorted((j.get("modelUsage") or {}).keys())
        out["cost_usd"] = j.get("total_cost_usd")
    except Exception:
        out["text"] = r.stdout[-4000:]
    return out


def run_judge(judge, prompt, images):
    spec = JUDGES[judge]
    fn = call_codex if spec["kind"] == "codex" else call_claude
    return fn(spec["model"], prompt, images)


class Cache:
    def __init__(self, out):
        self.dir = Path(out) / "raw"
        self.dir.mkdir(parents=True, exist_ok=True)

    def key(self, judge, task):
        return hashlib.sha256(json.dumps([judge, task, RUBRIC_SHA], sort_keys=True).encode()).hexdigest()[:20]

    def get(self, judge, task):
        f = self.dir / f"{judge}-{self.key(judge, task)}.json"
        if f.exists():
            d = json.loads(f.read_text())
            if d.get("parsed") is not None:
                return d
        return None

    def put(self, judge, task, rec):
        f = self.dir / f"{judge}-{self.key(judge, task)}.json"
        f.write_text(json.dumps(rec, indent=1))


def execute(out, jobs, retries=2):
    """jobs: list of (judge, task, prompt, images, parse_fn). Returns list of records in order."""
    cache = Cache(out)
    results = [None] * len(jobs)
    pools = {k: cf.ThreadPoolExecutor(max_workers=v) for k, v in CONCURRENCY.items()}
    futs = {}
    for i, (judge, task, prompt, images, parse) in enumerate(jobs):
        hit = cache.get(judge, task)
        if hit:
            results[i] = hit
            continue

        def work(judge=judge, task=task, prompt=prompt, images=images, parse=parse):
            rec = None
            for attempt in range(retries + 1):
                t = time.time()
                try:
                    raw = run_judge(judge, prompt, images)
                except Exception as e:  # timeout etc.
                    raw = {"text": "", "error": repr(e)}
                rec = {"judge": judge, "task": task, "seconds": round(time.time() - t, 1),
                       "attempt": attempt, "rubric_sha256": RUBRIC_SHA, **raw, "parsed": None}
                try:
                    rec["parsed"] = parse(extract_json(raw.get("text", "")))
                    break
                except Exception as e:
                    rec["parse_error"] = repr(e)[:300]
            cache.put(judge, task, rec)
            return rec

        futs[pools[JUDGES[judge]["kind"]].submit(work)] = i
    for f in cf.as_completed(futs):
        i = futs[f]
        results[i] = f.result()
        r = results[i]
        print(f"  {r['judge']:<20} {r['task'].get('id', '')[:48]:<48} "
              f"{'ok' if r['parsed'] is not None else 'FAIL'} {r.get('seconds')}s", flush=True)
    for p in pools.values():
        p.shutdown()
    return results


# ---------- prompts ----------
ABS_PROMPT = """You are a blind critic for a city-builder game built inside a 3D globe app (GEV, "God's Eye View").
Score the single attached image on each layer, 1-5 integers, using ONLY this frozen rubric:
{rubric}

Context: {context}
Judge only what is visible. If a layer cannot be judged from this image, still give your best integer and say so in notes.
Also list up to 5 visible defects, each with: what, where (screen region), severity 1-3 (3 = worst), area_pct (approx % of frame affected).
Reply with JSON only:
{{"scores": {{{score_keys}}}, "notes": {{"<layer>": "<=20 words"}}, "defects": [{{"what": "", "where": "", "severity": 1, "area_pct": 0}}]}}"""

PAIR_PROMPT = """You are a blind critic for a city-builder game built inside a 3D globe app (GEV, "God's Eye View").
Two images are attached: image A first, image B second. For each layer below, say which image is better on THAT layer only: "A", "B" or "TIE".
Frozen rubric:
{rubric}

Context: {context}
Reply with JSON only:
{{"verdicts": {{{verdict_keys}}}, "reasons": {{"<layer>": "<=15 words"}}}}"""


def parse_abs(layers):
    def p(d):
        s = d["scores"]
        out = {k: int(s[k]) for k in layers}
        assert all(1 <= v <= 5 for v in out.values())
        return {"scores": out, "notes": d.get("notes", {}), "defects": d.get("defects", [])}
    return p


def parse_pair(layers):
    def p(d):
        v = d["verdicts"]
        out = {k: str(v[k]).strip().upper() for k in layers}
        assert all(x in ("A", "B", "TIE") for x in out.values())
        return {"verdicts": out, "reasons": d.get("reasons", {})}
    return p


def cmd_vision_check(a):
    tmp = Path(a.out) / "img"
    tmp.mkdir(parents=True, exist_ok=True)
    img = prep_image(a.image, tmp)
    expect = [w.strip().lower() for w in a.expect.split(",") if w.strip()]
    prompt = ("Describe the attached image in 2-3 sentences: what kind of screen it is and any headings you can read. "
              'Reply JSON only: {"description": "..."}')
    jobs = [(j, {"id": "vision-check", "image": Path(a.image).name}, prompt, [img],
             lambda d: {"description": d["description"]}) for j in JUDGES]
    res = execute(a.out, jobs)
    report = {}
    for r in res:
        desc = (r["parsed"] or {}).get("description", "")
        hits = [w for w in expect if w in desc.lower()]
        report[r["judge"]] = {"pass": len(hits) >= max(1, len(expect) // 2), "hits": hits,
                              "description": desc, "model_reported": r.get("model_reported")}
    Path(a.out, "vision-check.json").write_text(json.dumps(report, indent=1))
    print(json.dumps({k: v["pass"] for k, v in report.items()}))


def cmd_absolute(a):
    items = json.loads(Path(a.items).read_text())
    layers = a.layers.split(",") if a.layers else LAYERS
    tmp = Path(a.out) / "img"
    tmp.mkdir(parents=True, exist_ok=True)
    jobs = []
    for it in items:
        img = prep_image(it["image"], tmp)
        prompt = ABS_PROMPT.format(rubric=rubric_text(layers), context=it.get("context", "none"),
                                   score_keys=", ".join(f'"{k}": 0' for k in layers))
        for j in JUDGES:
            jobs.append((j, {"id": it["id"], "kind": "abs", "layers": layers,
                             "img": hashlib.sha256(Path(it["image"]).read_bytes()).hexdigest()[:16],
                             "context": it.get("context", "")}, prompt, [img], parse_abs(layers)))
    res = execute(a.out, jobs)
    table = {}
    for r in res:
        table.setdefault(r["task"]["id"], {})[r["judge"]] = r["parsed"]
    summary = {}
    for iid, per in table.items():
        ok = {j: v for j, v in per.items() if v}
        mean = {k: round(sum(v["scores"][k] for v in ok.values()) / len(ok), 2) for k in layers} if ok else {}
        spread = {k: max(v["scores"][k] for v in ok.values()) - min(v["scores"][k] for v in ok.values())
                  for k in layers} if ok else {}
        summary[iid] = {"mean": mean, "spread": spread, "judges": {j: v["scores"] for j, v in ok.items()},
                        "failed_judges": [j for j, v in per.items() if not v]}
    Path(a.out, a.name + ".json").write_text(json.dumps({"rubric_sha256": RUBRIC_SHA, "layers": layers,
                                                         "summary": summary, "detail": table}, indent=1))
    for iid, s in summary.items():
        print(iid, s["mean"])


def cmd_pairwise(a):
    pairs = json.loads(Path(a.pairs).read_text())
    tmp = Path(a.out) / "img"
    tmp.mkdir(parents=True, exist_ok=True)
    jobs = []
    for p in pairs:
        layers = p.get("layers") or LAYERS
        ia, ib = prep_image(p["a"], tmp), prep_image(p["b"], tmp)
        prompt = PAIR_PROMPT.format(rubric=rubric_text(layers), context=p.get("context", "none"),
                                    verdict_keys=", ".join(f'"{k}": "A|B|TIE"' for k in layers))
        for order, imgs in (("ab", [ia, ib]), ("ba", [ib, ia])):
            for j in JUDGES:
                jobs.append((j, {"id": p["id"], "kind": "pair", "order": order, "layers": layers,
                                 "a": hashlib.sha256(Path(p["a"]).read_bytes()).hexdigest()[:16],
                                 "b": hashlib.sha256(Path(p["b"]).read_bytes()).hexdigest()[:16]},
                             prompt, imgs, parse_pair(layers)))
    res = execute(a.out, jobs)
    by = {}
    for r in res:
        by.setdefault(r["task"]["id"], {}).setdefault(r["judge"], {})[r["task"]["order"]] = r["parsed"]
    summary = {}
    for pid, per in by.items():
        layers = next(p.get("layers") or LAYERS for p in pairs if p["id"] == pid)
        judge_v = {}
        for j, orders in per.items():
            ab, ba = orders.get("ab"), orders.get("ba")
            jv = {}
            for k in layers:
                if not ab or not ba:
                    jv[k] = "MISSING"
                    continue
                x = ab["verdicts"][k]
                y = {"A": "B", "B": "A", "TIE": "TIE"}[ba["verdicts"][k]]  # map back to original labels
                jv[k] = x if x == y else "TIE"
            judge_v[j] = jv
        panel = {}
        for k in layers:
            votes = [v[k] for v in judge_v.values() if v[k] in ("A", "B")]
            na, nb = votes.count("A"), votes.count("B")
            n_j = len(judge_v)
            panel[k] = "A" if na > n_j / 2 else "B" if nb > n_j / 2 else "TIE"
        summary[pid] = {"panel": panel, "judges": judge_v}
    Path(a.out, a.name + ".json").write_text(json.dumps({"rubric_sha256": RUBRIC_SHA, "summary": summary,
                                                         "pairs": pairs}, indent=1))
    for pid, s in summary.items():
        print(pid, s["panel"])


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("vision-check"); v.add_argument("--out", required=True)
    v.add_argument("--image", required=True); v.add_argument("--expect", required=True)
    b = sub.add_parser("absolute"); b.add_argument("--out", required=True); b.add_argument("--items", required=True)
    b.add_argument("--layers", default=""); b.add_argument("--name", default="absolute")
    c = sub.add_parser("pairwise"); c.add_argument("--out", required=True); c.add_argument("--pairs", required=True)
    c.add_argument("--name", default="pairwise")
    a = ap.parse_args()
    {"vision-check": cmd_vision_check, "absolute": cmd_absolute, "pairwise": cmd_pairwise}[a.cmd](a)


if __name__ == "__main__":
    main()
