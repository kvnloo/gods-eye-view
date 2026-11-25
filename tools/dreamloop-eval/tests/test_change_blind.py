"""Visible-change tolerance and the blinded A/B packet: determinism, side swap, leakage audit, sealed key, tally."""
import json
import unittest
import zlib

import numpy as np

from dreamloop_eval import blind, change
from dreamloop_eval.manifest import ManifestError, load_manifest, load_split

from helpers import Fixture, VIEWS, image, vseed


class VisibleChange(unittest.TestCase):
    def setUp(self):
        self.fx = Fixture()
        self.split = load_split(self.fx.split_path)

    def tearDown(self):
        self.fx.close()

    def run_change(self, cand_recs):
        m = load_manifest(self.fx.manifest(self.fx.build("par", "r1") + cand_recs), self.split)
        return change.visible_change(m, ("par", "r1"), (cand_recs[0]["build_id"], "r1"))

    def test_unchanged_build_is_invisible(self):
        out = self.run_change(self.fx.build("same", "r1"))
        self.assertEqual(out["panels"]["train"]["median"], 0.0)
        self.assertTrue(out["invisible"])
        self.assertIn("change the approach", out["verdict"])

    def test_large_change_is_visible(self):
        out = self.run_change(self.fx.build("brt", "r1", shift=0.2))
        self.assertGreater(out["panels"]["heldout"]["median"], 0.5)
        self.assertFalse(out["invisible"])

    def test_tolerance_is_a_threshold(self):
        a, b = self.fx.dir / "a.png", self.fx.dir / "b.png"
        base = np.full((64, 96, 3), 128, np.uint8)
        self.fx.png("a.png", base)
        self.fx.png("b.png", base + 3)  # ~1.2 dE76 uniform shift: below 5, above 1
        self.assertEqual(change.changed_share(a, b, tol=5.0), 0.0)
        self.assertEqual(change.changed_share(a, b, tol=1.0), 1.0)

    def test_change_only_in_a_corner_reports_its_share(self):
        recs = []
        for loc, vid in VIEWS:
            im = image(vseed(vid)).copy()
            im[:16, :24] = 255 - im[:16, :24]  # 1/16 of the frame inverted
            recs.append(self.fx.record("corner", "r1", loc, vid, self.fx.capture("corner", "r1", vid, im)))
        out = self.run_change(recs)
        self.assertAlmostEqual(out["panels"]["train"]["median"], 1 / 16, delta=0.02)
        self.assertFalse(out["invisible"])  # 6.25% >= 5%


class Packets(unittest.TestCase):
    def setUp(self):
        self.fx = Fixture()
        self.split = load_split(self.fx.split_path)
        recs = self.fx.build("parent-build@abc", "run-p") + self.fx.build("cand-build@def", "run-c", shift=0.1)
        self.m = load_manifest(self.fx.manifest(recs), self.split)
        self.P, self.C = ("parent-build@abc", "run-p"), ("cand-build@def", "run-c")

    def tearDown(self):
        self.fx.close()

    def make(self, name, seed="s1", k=None):
        return blind.make_packets(self.m, self.P, self.C, seed, k or {"heldout": 2, "train": 2}, self.fx.dir / name)

    def tree(self, name):
        root = self.fx.dir / name
        return {str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}

    def test_same_seed_same_packet_bytes(self):
        self.make("a")
        self.make("b")
        self.assertEqual(self.tree("a"), self.tree("b"))

    def test_different_seed_reorders(self):
        a, b = self.make("a", "s1"), self.make("b", "s2")
        self.assertNotEqual(sorted(a["items"]), sorted(b["items"]))

    def test_sampling_is_per_panel_and_reports_shortfall(self):
        s = self.make("a", k={"heldout": 5, "train": 1})
        views = {i["view_id"] for i in s["items"].values()}
        self.assertEqual(sum(v.startswith("B0") for v in views), 2)
        self.assertEqual(sum(v.startswith("A") for v in views), 1)
        self.assertEqual(s["shortfall"], {"heldout": {"wanted": 5, "available": 2}})

    def test_seat_two_swaps_sides(self):
        s = self.make("a")
        by_view = {}
        for it in s["items"].values():
            by_view.setdefault(it["view_id"], {})[it["seat"]] = it["candidate_is"]
        for sides in by_view.values():
            self.assertEqual({sides["seat1"], sides["seat2"]}, {"X", "Y"})

    def test_packet_images_match_the_sealed_mapping(self):
        s = self.make("a")
        item, it = next(iter(s["items"].items()))
        d = self.fx.dir / "a" / "packet" / it["seat"] / item
        import cv2
        cand = [r for r in self.m.scorable(*self.C) if r.view_id == it["view_id"]][0]
        want = cv2.imread(str(cand.capture_path))
        got = cv2.imread(str(d / f"{it['candidate_is']}.png"))
        self.assertTrue(np.array_equal(want, got))

    def test_judge_visible_files_carry_no_identity(self):
        self.make("a")
        pk = self.fx.dir / "a" / "packet"
        blob = b"".join(p.read_bytes() for p in pk.rglob("*") if p.is_file() and p.suffix != ".png")
        for tok in (b"parent", b"candidate", b"cand-build", b"run-p", b"A0-V0", b"B0-V1", b"heldout", b"train"):
            self.assertNotIn(tok, blob)
        self.assertFalse(list(pk.rglob("unblind.json")))
        self.assertTrue((self.fx.dir / "a" / "sealed" / "unblind.json").exists())

    def test_audit_catches_planted_identity(self):
        self.make("a")
        f = next((self.fx.dir / "a" / "packet" / "seat1").glob("i*/"))
        (f / "note.txt").write_text("rendered by cand-build@def")
        with self.assertRaises(blind.LeakageError):
            blind.audit_packet(self.fx.dir / "a")

    def test_audit_catches_png_text_chunk(self):
        self.make("a")
        png = next((self.fx.dir / "a" / "packet" / "seat2").rglob("X.png"))
        data = png.read_bytes()
        body = b"tEXt" + b"Comment\x00hello"
        chunk = (len(body) - 4).to_bytes(4, "big") + body + zlib.crc32(body).to_bytes(4, "big")
        png.write_bytes(data[:33] + chunk + data[33:])  # after IHDR
        with self.assertRaises(blind.LeakageError):
            blind.audit_packet(self.fx.dir / "a")

    def test_ambiguous_run_is_rejected_not_merged(self):
        recs = self.fx.build("parent-build@abc", "run-p") + self.fx.build("cand-build@def", "run-c", shift=0.1) \
            + self.fx.build("cand-build@def", "run-c2", shift=0.1)
        m = load_manifest(self.fx.manifest(recs, "m2.jsonl"), self.split)
        with self.assertRaises(ManifestError):
            blind.make_packets(m, ("parent-build@abc", None), ("cand-build@def", None), "s1", {"heldout": 1}, self.fx.dir / "x")
        with self.assertRaises(ManifestError):
            change.visible_change(m, ("parent-build@abc", None), ("cand-build@def", None))
        out = change.visible_change(m, ("parent-build@abc", None), ("cand-build@def", "run-c2"))
        self.assertEqual(out["candidate"], ["cand-build@def", "run-c2"])

    def test_packets_are_write_once(self):
        self.make("a")
        with self.assertRaises(ManifestError):
            self.make("a")

    def test_tally_missing_verdicts_fail_the_gate(self):
        s = self.make("a")
        out = self.fx.dir / "a"
        first = next(i for i, it in s["items"].items() if it["seat"] == "seat1")
        blind.record_verdict(out, "seat1", first, s["items"][first]["candidate_is"], "j1")
        r = blind.tally(out)
        self.assertFalse(r["gate"]["pass"])
        self.assertEqual(r["missing_seats"], 7)
        self.assertTrue(any("missing" in x for x in r["gate"]["reasons"]))

    def test_tally_candidate_sweep_passes_and_ties_count(self):
        s = self.make("a")
        out = self.fx.dir / "a"
        for item, it in s["items"].items():
            blind.record_verdict(out, it["seat"], item, it["candidate_is"], "j")
        r = blind.tally(out)
        self.assertEqual((r["candidate_seats"], r["candidate_both"], r["gate"]["pass"]), (8, 4, True))
        self.assertTrue((out / "result.json").exists())
        # a tie is not a candidate seat: 4 ties of 8 -> 50% < 60%
        out2 = self.fx.dir / "b"
        s2 = self.make("b")
        for n, (item, it) in enumerate(s2["items"].items()):
            blind.record_verdict(out2, it["seat"], item, "tie" if n % 2 else it["candidate_is"], "j")
        r2 = blind.tally(out2)
        self.assertEqual(r2["tie_seats"], 4)
        self.assertFalse(r2["gate"]["pass"])

    def test_verdict_for_foreign_item_is_rejected(self):
        s = self.make("a")
        seat2_item = next(i for i, it in s["items"].items() if it["seat"] == "seat2")
        with self.assertRaises(ManifestError):
            blind.record_verdict(self.fx.dir / "a", "seat1", seat2_item, "X", "j")
        verdict_dir = self.fx.dir / "a" / "verdicts"
        self.assertEqual(list(verdict_dir.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
