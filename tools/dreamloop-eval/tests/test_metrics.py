"""Metric behaviour: per-view colour/edge numbers, missing classes, and explicit failure when LPIPS/DISTS can't load."""
import builtins
import contextlib
import io
import unittest
from unittest import mock

import numpy as np

from dreamloop_eval import cli, metrics
from dreamloop_eval.manifest import load_manifest, load_split

from helpers import Fixture, image


@contextlib.contextmanager
def blocked(*mods):
    real = builtins.__import__

    def fake(name, *a, **k):
        if name.split(".")[0] in mods:
            raise ImportError(f"blocked {name} (test)")
        return real(name, *a, **k)
    with mock.patch.object(builtins, "__import__", fake):
        yield


class ColourAndEdges(unittest.TestCase):
    def setUp(self):
        self.fx = Fixture()
        self.split = load_split(self.fx.split_path)

    def tearDown(self):
        self.fx.close()

    def score(self, recs, wanted=("class_de", "class_spread_de", "edge_dist")):
        m = load_manifest(self.fx.manifest(recs), self.split)
        return {r.view_id: metrics.score_view(r, wanted, work=(96, 64)) for r in m.scorable()}

    def test_capture_equal_to_target_scores_zero(self):
        s = self.score(self.fx.build("same", "r1"))["A0-V0"]
        self.assertAlmostEqual(s["metrics"]["class_de"], 0, places=5)
        self.assertAlmostEqual(s["metrics"]["edge_dist"], 0, places=5)

    def test_brighter_capture_has_larger_class_de(self):
        a = self.score(self.fx.build("same", "r1"))["A0-V0"]["metrics"]["class_de"]
        b = self.score(self.fx.build("bright", "r1", shift=0.15))["A0-V0"]["metrics"]["class_de"]
        self.assertGreater(b, a + 5)

    def test_small_class_is_absent_not_zero(self):
        s = self.score(self.fx.build("same", "r1"))["A0-V0"]
        self.assertFalse(s["classes"]["water"]["present"])  # 1 px < 0.5%
        self.assertNotIn("de", s["classes"]["water"])
        self.assertTrue(s["classes"]["veg"]["present"])

    def test_missing_mask_is_unavailable_not_estimated(self):
        recs = self.fx.build("same", "r1")
        recs[0]["class_mask"] = None
        s = self.score(recs)["A0-V0"]
        self.assertIsNone(s["metrics"]["class_de"])
        self.assertEqual(s["unavailable"]["class_de"], "no_class_mask")

    def test_ignore_rect_is_excluded(self):
        recs = self.fx.build("diff", "r1", seed_off=7)
        recs[0]["target"]["ignore_rects"] = [[0, 0, 1, 1 / 64 * 8]]
        x, t, valid, cls = metrics.load_view(load_manifest(self.fx.manifest(recs), self.split).records[0], (96, 64))
        self.assertFalse(valid[:8].any())
        self.assertTrue((cls[:8] == metrics.UNKNOWN).all())
        self.assertTrue(np.allclose(x[:8], t[:8]))

    def test_wrong_aspect_target_is_rejected(self):
        recs = self.fx.build("same", "r1")
        sq = self.fx.png("targets/square.png", image(1)[:, :64])
        from dreamloop_eval.manifest import sha256, ManifestError
        recs[0]["target"].update(path=str(sq), sha256=sha256(sq))
        with self.assertRaises(ManifestError):
            self.score(recs)


class UnavailablePerceptual(unittest.TestCase):
    def test_blocked_import_raises_metric_unavailable(self):
        with blocked("piq"):
            with self.assertRaises(metrics.MetricUnavailable) as cm:
                metrics.Perceptual().check(["dists"])
        self.assertIn("dists", str(cm.exception))

    def test_score_command_fails_and_writes_nothing(self):
        fx = Fixture()
        try:
            mf = fx.manifest(fx.build("c", "r1"))
            out = fx.dir / "scores.json"
            with blocked("lpips", "piq"), self.assertRaises(SystemExit) as cm, contextlib.redirect_stdout(io.StringIO()):
                cli.main(["score", "--manifest", str(mf), "--split", str(fx.split_path), "--build", "c",
                          "--work", "96x64", "--out", str(out)])
            self.assertIn("METRIC UNAVAILABLE", str(cm.exception))
            self.assertFalse(out.exists())
        finally:
            fx.close()


def _have(*mods):
    try:
        for m in mods:
            __import__(m)
        return True
    except Exception:
        return False


@unittest.skipUnless(_have("torch", "lpips", "piq"), "torch/lpips/piq not importable in this interpreter")
class RealPerceptual(unittest.TestCase):
    def test_identical_is_zero_and_different_is_larger(self):
        p = metrics.Perceptual()
        a = image(3).astype(np.float32) / 255
        b = image(9).astype(np.float32) / 255
        for name in metrics.PERCEPTUAL:
            same, diff = p(name, a, a), p(name, a, b)
            self.assertLess(same, 1e-3, name)
            self.assertGreater(diff, same + 0.05, name)


if __name__ == "__main__":
    unittest.main()
