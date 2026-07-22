import tempfile
import unittest
import json
from pathlib import Path

from lifecycle import GX_CORE_VERSION, GxLifecycle, LifecycleError


NOT_NULL = {
    "type": "expect_column_values_to_not_be_null",
    "kwargs": {"column": "pan"},
}
UNIQUE = {
    "type": "expect_column_values_to_be_unique",
    "kwargs": {"column": "customer_id"},
}


class SuiteLifecycleTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.lifecycle = GxLifecycle(self.root)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_real_supported_gx_core_is_loaded(self) -> None:
        self.assertEqual(GX_CORE_VERSION, "1.19.0")

    def test_suite_crud_is_versioned_and_persists_across_context_restart(self) -> None:
        created = self.lifecycle.create_suite("org_bharat", "kyc", "PAN checks", [NOT_NULL])
        self.assertEqual(created["version"], 1)
        self.assertEqual(created["expectations"], [NOT_NULL])

        # A new service object loads the suite from GX's filesystem Expectations Store.
        restarted = GxLifecycle(self.root)
        self.assertEqual(restarted.get_suite("org_bharat", "kyc"), created)
        self.assertEqual(restarted.list_suites("org_bharat"), [created])

        updated = restarted.update_suite(
            "org_bharat", "kyc", expected_version=1, description="PAN + ID", expectations=[NOT_NULL, UNIQUE]
        )
        self.assertEqual(updated["version"], 2)
        self.assertEqual(len(updated["expectations"]), 2)
        with self.assertRaisesRegex(LifecycleError, "version conflicts") as conflict:
            restarted.update_suite("org_bharat", "kyc", expected_version=1, description="stale")
        self.assertEqual(conflict.exception.status, 409)

        restarted.delete_suite("org_bharat", "kyc", expected_version=2)
        self.assertEqual(GxLifecycle(self.root).list_suites("org_bharat"), [])

    def test_tenants_are_physically_isolated_and_names_cannot_escape_state_root(self) -> None:
        self.lifecycle.create_suite("org_a", "kyc", "A", [NOT_NULL])
        self.lifecycle.create_suite("org_b", "claims", "B", [UNIQUE])
        self.assertEqual([suite["name"] for suite in self.lifecycle.list_suites("org_a")], ["kyc"])
        self.assertEqual([suite["name"] for suite in self.lifecycle.list_suites("org_b")], ["claims"])
        self.assertTrue((self.root / "tenants" / "org_a" / "gx" / "expectations").is_dir())
        self.assertTrue((self.root / "tenants" / "org_b" / "gx" / "expectations").is_dir())
        with self.assertRaises(LifecycleError):
            self.lifecycle.list_suites("../org_b")

    def test_create_rejects_duplicates_and_unsupported_expectations(self) -> None:
        self.lifecycle.create_suite("org_a", "kyc", "A", [NOT_NULL])
        with self.assertRaisesRegex(LifecycleError, "already exists") as duplicate:
            self.lifecycle.create_suite("org_a", "kyc", "A", [NOT_NULL])
        self.assertEqual(duplicate.exception.status, 409)
        with self.assertRaisesRegex(LifecycleError, "unsupported expectation"):
            self.lifecycle.create_suite(
                "org_a", "invalid", "", [{"type": "expect_sql_to_pass", "kwargs": {"column": "x"}}]
            )

    def test_profile_reads_only_a_server_owned_tenant_asset_and_returns_bounded_stats(self) -> None:
        asset = self.root / "tenants" / "org_a" / "assets" / "warehouse" / "customers.jsonl"
        asset.parent.mkdir(parents=True)
        rows = [
            {"customer_id": 1, "pan": "ABCDE1234F", "amount": 100},
            {"customer_id": 2, "pan": "", "amount": 250},
            {"customer_id": 3, "pan": None, "amount": 50},
        ]
        asset.write_text("\n".join(json.dumps(row) for row in rows))

        profile = self.lifecycle.profile("org_a", "warehouse", "customers", sample_limit=2)
        self.assertEqual(profile["sampledRows"], 2)
        pan = next(column for column in profile["columns"] if column["name"] == "pan")
        self.assertEqual(pan["rowCount"], 2)
        self.assertEqual(pan["nullCount"], 1)
        amount = next(column for column in profile["columns"] if column["name"] == "amount")
        self.assertEqual((amount["min"], amount["max"]), (100, 250))

        with self.assertRaisesRegex(LifecycleError, "not found") as other_tenant:
            self.lifecycle.profile("org_b", "warehouse", "customers", sample_limit=2)
        self.assertEqual(other_tenant.exception.status, 404)

    def test_profile_rejects_malformed_assets_and_unbounded_reads(self) -> None:
        asset = self.root / "tenants" / "org_a" / "assets" / "warehouse" / "bad.json"
        asset.parent.mkdir(parents=True)
        asset.write_text('{"not": "rows"}')
        with self.assertRaisesRegex(LifecycleError, "JSON objects") as malformed:
            self.lifecycle.profile("org_a", "warehouse", "bad", sample_limit=10)
        self.assertEqual(malformed.exception.status, 422)
        with self.assertRaisesRegex(LifecycleError, "limit"):
            self.lifecycle.profile("org_a", "warehouse", "bad", sample_limit=100_001)

    def test_real_gx_validation_returns_pass_and_fail_and_retains_results(self) -> None:
        self.lifecycle.create_suite("org_a", "kyc", "PAN required", [NOT_NULL])
        passing = self.lifecycle.validate(
            "org_a",
            "kyc",
            {"kind": "inline", "rows": [{"pan": "ABCDE1234F"}]},
            idempotency_key="run_pass",
        )
        self.assertTrue(passing["success"])
        self.assertEqual(passing["engine"], "great-expectations")
        self.assertEqual(passing["engineVersion"], "1.19.0")
        self.assertEqual((passing["evaluated"], passing["failed"]), (1, 0))

        failing = self.lifecycle.validate(
            "org_a",
            "kyc",
            {"kind": "inline", "rows": [{"pan": None}]},
            idempotency_key="run_fail",
        )
        self.assertFalse(failing["success"])
        self.assertEqual((failing["evaluated"], failing["failed"]), (1, 1))
        self.assertEqual(failing["outcomes"][0]["unexpectedCount"], 1)

        context = self.lifecycle.context("org_a")
        self.assertEqual(len(context.stores["validation_results_store"].list_keys()), 2)
        self.assertEqual(len(context.validation_definitions.all()), 1)

    def test_validation_is_idempotent_and_rejects_key_reuse_with_different_input(self) -> None:
        self.lifecycle.create_suite("org_a", "kyc", "PAN required", [NOT_NULL])
        request = {"kind": "inline", "rows": [{"pan": "ABCDE1234F"}]}
        first = self.lifecycle.validate("org_a", "kyc", request, idempotency_key="same_run")
        replay = self.lifecycle.validate("org_a", "kyc", request, idempotency_key="same_run")
        self.assertEqual(replay, first)
        context = self.lifecycle.context("org_a")
        self.assertEqual(len(context.stores["validation_results_store"].list_keys()), 1)

        with self.assertRaisesRegex(LifecycleError, "already used") as conflict:
            self.lifecycle.validate(
                "org_a", "kyc", {"kind": "inline", "rows": [{"pan": None}]}, "same_run"
            )
        self.assertEqual(conflict.exception.status, 409)

    def test_validation_reads_a_governed_asset_without_accepting_a_caller_path(self) -> None:
        self.lifecycle.create_suite("org_a", "kyc", "PAN required", [NOT_NULL])
        asset = self.root / "tenants" / "org_a" / "assets" / "warehouse" / "customers.json"
        asset.parent.mkdir(parents=True)
        asset.write_text(json.dumps([{"pan": "ABCDE1234F"}, {"pan": None}]))
        result = self.lifecycle.validate(
            "org_a",
            "kyc",
            {"kind": "asset", "dataSourceId": "warehouse", "assetName": "customers", "limit": 50},
        )
        self.assertFalse(result["success"])
        self.assertEqual(result["dataSourceId"], "warehouse")
        self.assertEqual(result["assetName"], "customers")
        with self.assertRaisesRegex(LifecycleError, "batch kind"):
            self.lifecycle.validate("org_a", "kyc", {"kind": "path", "path": "/etc/passwd"})

    def test_history_is_derived_from_gx_results_and_survives_service_restart(self) -> None:
        self.lifecycle.create_suite("org_a", "kyc", "PAN required", [NOT_NULL])
        pass_run = self.lifecycle.validate(
            "org_a", "kyc", {"kind": "inline", "rows": [{"pan": "ABCDE1234F"}]}, "pass_1"
        )
        fail_run = self.lifecycle.validate(
            "org_a", "kyc", {"kind": "inline", "rows": [{"pan": None}]}, "fail_1"
        )

        restarted = GxLifecycle(self.root)
        history = restarted.history("org_a", limit=1, suite_name="kyc")
        self.assertEqual(len(history["runs"]), 1)
        self.assertIn(history["runs"][0]["id"], {pass_run["id"], fail_run["id"]})
        self.assertIsNotNone(history["nextCursor"])
        second = restarted.history(
            "org_a", limit=1, suite_name="kyc", cursor=history["nextCursor"]
        )
        self.assertEqual(len(second["runs"]), 1)
        self.assertNotEqual(second["runs"][0]["id"], history["runs"][0]["id"])
        self.assertIsNone(second["nextCursor"])

        # Replaying after restart returns the durable receipt without adding another GX result.
        replay = restarted.validate(
            "org_a", "kyc", {"kind": "inline", "rows": [{"pan": "ABCDE1234F"}]}, "pass_1"
        )
        self.assertEqual(replay, pass_run)
        self.assertEqual(
            len(restarted.context("org_a").stores["validation_results_store"].list_keys()), 2
        )

    def test_history_is_tenant_scoped_and_fails_closed_on_bad_filters_or_cursors(self) -> None:
        self.lifecycle.create_suite("org_a", "kyc", "PAN required", [NOT_NULL])
        self.lifecycle.validate("org_a", "kyc", {"kind": "inline", "rows": []})
        self.assertEqual(len(self.lifecycle.history("org_a", limit=50)["runs"]), 1)
        self.assertEqual(self.lifecycle.history("org_b", limit=50)["runs"], [])
        self.assertEqual(
            self.lifecycle.history("org_a", limit=50, data_source_id="warehouse")["runs"], []
        )
        with self.assertRaisesRegex(LifecycleError, "cursor"):
            self.lifecycle.history("org_a", limit=50, cursor="unknown")
        with self.assertRaisesRegex(LifecycleError, "limit"):
            self.lifecycle.history("org_a", limit=201)


if __name__ == "__main__":
    unittest.main()
