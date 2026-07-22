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


if __name__ == "__main__":
    unittest.main()
