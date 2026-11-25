"""The boundary: cross-view target pairing, panel leakage and file identity are rejected before anything is scored."""
import copy
import json
import unittest

from dreamloop_eval.manifest import ManifestError, load_manifest, load_split

from helpers import Fixture


class ManifestBoundary(unittest.TestCase):
    def setUp(self):
        self.fx = Fixture()
        self.split = load_split(self.fx.split_path)
        self.recs = self.fx.build("cand", "r1")

    def tearDown(self):
        self.fx.close()

    def load(self, recs):
        return load_manifest(self.fx.manifest(recs), self.split)

    def reject(self, recs, needle):
        with self.assertRaises(ManifestError) as cm:
            self.load(recs)
        self.assertIn(needle, str(cm.exception))

    def test_valid_manifest_loads(self):
        m = self.load(self.recs)
        self.assertEqual(len(m.scorable("cand", "r1")), 5)

    def test_target_of_another_view_is_rejected(self):
        recs = copy.deepcopy(self.recs)
        recs[0]["target"] = copy.deepcopy(recs[1]["target"])  # A0-V0 pointed at A0-V1's target
        self.reject(recs, "cross-view pairing")

    def test_lone_record_with_another_views_target_is_rejected(self):
        # no second record shares the target sha here: only the per-record view_id check can catch it
        rec = copy.deepcopy(self.recs[0])
        rec["target"] = copy.deepcopy(self.recs[1]["target"])
        self.reject([rec], "target belongs to 'A0-V1'")

    def test_relabelled_target_of_another_view_is_rejected(self):
        recs = copy.deepcopy(self.recs)
        recs[0]["target"] = {**copy.deepcopy(recs[1]["target"]), "view_id": "A0-V0"}  # lies about its view
        self.reject(recs, "cross-view pairing")

    def test_class_mask_of_another_view_is_rejected(self):
        recs = copy.deepcopy(self.recs)
        recs[0]["class_mask"] = copy.deepcopy(recs[1]["class_mask"])
        self.reject(recs, "class mask belongs to")

    def test_target_camera_must_match(self):
        recs = copy.deepcopy(self.recs)
        recs[0]["target"]["camera"] = {"view": "elsewhere"}
        self.reject(recs, "camera")

    def test_heldout_location_labelled_train_is_panel_leakage(self):
        recs = copy.deepcopy(self.recs)
        recs[3]["panel"] = "train"  # B0 is held-out in the split
        self.reject(recs, "panel leakage")

    def test_location_outside_split_is_rejected(self):
        recs = copy.deepcopy(self.recs)
        recs[0].update(location_id="Z9", view_id="Z9-V0")
        recs[0]["target"]["view_id"] = "Z9-V0"
        recs[0]["class_mask"]["view_id"] = "Z9-V0"
        self.reject(recs, "not in split")

    def test_view_must_belong_to_its_location(self):
        recs = copy.deepcopy(self.recs)
        recs[0]["location_id"] = "A1"
        self.reject(recs, "does not belong")

    def test_split_with_location_in_both_panels_is_rejected(self):
        bad = json.loads(self.fx.split_path.read_text())
        bad["panels"]["heldout"].append("A0")
        p = self.fx.dir / "bad-split.json"
        p.write_text(json.dumps(bad))
        with self.assertRaises(ManifestError) as cm:
            load_split(p)
        self.assertIn("panel leakage", str(cm.exception))

    def test_hash_mismatch_is_rejected(self):
        recs = copy.deepcopy(self.recs)
        recs[2]["capture"]["sha256"] = "0" * 64
        self.reject(recs, "sha256 mismatch")

    def test_size_mismatch_is_rejected(self):
        recs = copy.deepcopy(self.recs)
        recs[2]["width"] = 1536
        self.reject(recs, "record says")

    def test_excluded_needs_reason_and_is_not_scored(self):
        recs = copy.deepcopy(self.recs)
        recs[4]["status"] = "excluded"
        self.reject(recs, "needs a reason")
        recs[4]["reason"] = "tiles never settled"
        m = self.load(recs)
        self.assertEqual(len(m.scorable("cand", "r1")), 4)
        self.assertEqual(len(m.expected("cand", "r1")), 5)

    def test_incomplete_record_without_capture_file_is_kept_for_coverage(self):
        recs = copy.deepcopy(self.recs)
        recs[3].update(status="incomplete", reason="tiles_incomplete", capture=None, width=None, height=None)
        m = self.load(recs)
        self.assertEqual([r.view_id for r in m.expected("cand", "r1") if not r.scorable], ["B0-V0"])
        recs[3]["status"] = "complete"  # a complete record must carry its capture
        self.reject(recs, "missing 'capture'")

    def test_duplicate_record_is_rejected(self):
        self.reject(self.recs + [self.recs[0]], "duplicate")


if __name__ == "__main__":
    unittest.main()
