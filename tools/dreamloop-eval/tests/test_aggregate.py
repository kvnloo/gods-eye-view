"""Deterministic aggregation on hand-checked fixtures (tests/fixtures/agg). Expected numbers are worked by hand in the
comments, not produced by the code under test."""
import copy
import json
import pathlib
import unittest

from dreamloop_eval import aggregate

F = pathlib.Path(__file__).parent / "fixtures" / "agg"


def load(name):
    return json.loads((F / name).read_text())


class Aggregation(unittest.TestCase):
    def test_quantile_linear(self):
        self.assertEqual(aggregate.quantile([3, 1, 2], .5), 2)
        self.assertAlmostEqual(aggregate.quantile([1, 2, 3, 4], .25), 1.75)  # pos 0.75 between 1 and 2
        self.assertEqual(aggregate.quantile([7], .95), 7)

    def test_summary_per_panel_never_pooled(self):
        s = load("cand.json")
        out = aggregate.summarize(s)
        tr, ho = out["train"]["dists"], out["heldout"]["dists"]
        # train dists [0.28, 0.21, 0.04] -> median 0.21, p25 0.125, p75 0.245
        self.assertEqual((tr["n"], tr["median"], tr["p25"], tr["p75"], tr["iqr"]), (3, 0.21, 0.125, 0.245, 0.12))
        self.assertEqual(tr["coverage"], 1.0)
        # held-out: B0-V1 incomplete -> 1 of 2 views, coverage 0.5, listed as not scored
        self.assertEqual((ho["n"], ho["median"], ho["coverage"]), (1, 0.2, 0.5))
        self.assertEqual([n["view_id"] for n in out["heldout"]["not_scored"]], ["B0-V1"])
        # class_de unavailable on A1-V0 (no mask): n 2/3, reason surfaced, median of [8, 12]
        cd = out["train"]["class_de"]
        self.assertEqual((cd["n"], cd["median"], cd["coverage"], cd["unavailable"]), (2, 10.0, 0.666667, ["no_class_mask"]))

    def test_summary_is_order_independent(self):
        s = load("cand.json")
        r = copy.deepcopy(s)
        r["views"].reverse()
        self.assertEqual(aggregate.summarize(s), aggregate.summarize(r))

    def test_paired_deltas(self):
        p = aggregate.paired(load("parent.json"), load("cand.json"))
        tr = p["panels"]["train"]["dists"]
        # deltas -0.02, +0.01, -0.06 -> median -0.02, 2 better, 1 worse
        self.assertEqual((tr["median"], tr["improved"], tr["worse"], tr["ties"]), (-0.02, 2, 1, 0))
        ho = p["panels"]["heldout"]
        self.assertEqual((ho["views_in_either"], ho["views_paired"], ho["dists"]["median"]), (2, 1, -0.05))
        cd = p["panels"]["train"]["class_de"]  # [-2, 0]: A1-V0 missing on both sides is skipped, not zero
        self.assertEqual((cd["n"], cd["median"], cd["improved"], cd["ties"]), (2, -1.0, 1, 1))

    def test_paired_rejects_different_targets_for_one_view(self):
        c = load("cand.json")
        c["views"][0]["target_sha256"] = "t-other"
        with self.assertRaises(aggregate.PairingError):
            aggregate.paired(load("parent.json"), c)

    def test_paired_rejects_different_split(self):
        c = load("cand.json")
        c["split"]["sha256"] = "other"
        with self.assertRaises(aggregate.PairingError):
            aggregate.paired(load("parent.json"), c)

    def test_noise_floor(self):
        n = aggregate.noise_floor([load("aa1.json"), load("aa2.json"), load("aa3.json")])
        ho = n["panels"]["heldout"]["dists"]
        # pair medians: (a1,a2) +0.0005, (a1,a3) -0.0005, (a2,a3) -0.001 -> floor 0.001
        self.assertEqual(ho["pair_median_deltas"], [0.0005, -0.0005, -0.001])
        self.assertEqual((ho["floor"], ho["per_view_abs_p50"], ho["per_view_abs_max"]), (0.001, 0.001, 0.003))

    def test_noise_floor_needs_three_runs_of_one_build(self):
        with self.assertRaises(ValueError):
            aggregate.noise_floor([load("aa1.json"), load("aa2.json")])
        with self.assertRaises(ValueError):
            aggregate.noise_floor([load("aa1.json"), load("aa2.json"), load("cand.json")])
        dup = load("aa2.json")
        dup["run_id"] = "a1"
        with self.assertRaises(ValueError):
            aggregate.noise_floor([load("aa1.json"), dup, load("aa3.json")])

    def test_beyond_noise(self):
        noise = aggregate.noise_floor([load("aa1.json"), load("aa2.json"), load("aa3.json")])
        pair = aggregate.paired(load("parent.json"), load("cand.json"))
        self.assertIs(aggregate.beyond_noise(pair, noise, "dists", "heldout"), True)    # -0.05 < -0.001
        small = copy.deepcopy(pair)
        small["panels"]["heldout"]["dists"]["median"] = -0.0005
        self.assertIs(aggregate.beyond_noise(small, noise, "dists", "heldout"), False)
        self.assertIsNone(aggregate.beyond_noise(pair, noise, "lpips", "heldout"))      # missing is not a pass


if __name__ == "__main__":
    unittest.main()
