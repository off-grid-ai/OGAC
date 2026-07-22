import json
import os
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import app as app_module
from lifecycle import GxLifecycle


class LifecycleApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        app_module.lifecycle = GxLifecycle(self.root)
        os.environ["OFFGRID_GX_SERVICE_TOKEN"] = "server-owned-secret"
        self.client = TestClient(app_module.app)
        self.headers = {
            "authorization": "Bearer server-owned-secret",
            "x-offgrid-org-id": "org_bharat",
            "x-offgrid-actor": "admin@bharatunion.example",
        }

    def tearDown(self) -> None:
        self.client.close()
        os.environ.pop("OFFGRID_GX_SERVICE_TOKEN", None)
        self.temp.cleanup()

    def test_authentication_and_tenant_context_fail_closed(self) -> None:
        self.assertEqual(self.client.get("/v1/capabilities").status_code, 401)
        wrong = {**self.headers, "authorization": "Bearer wrong"}
        self.assertEqual(self.client.get("/v1/capabilities", headers=wrong).status_code, 401)
        escaped = {**self.headers, "x-offgrid-org-id": "../other"}
        self.assertEqual(self.client.get("/v1/suites", headers=escaped).status_code, 400)

        os.environ.pop("OFFGRID_GX_SERVICE_TOKEN")
        self.assertEqual(self.client.get("/v1/capabilities", headers=self.headers).status_code, 503)

    def test_full_authenticated_lifecycle_uses_real_persistent_gx_stores(self) -> None:
        manifest = self.client.get("/v1/capabilities", headers=self.headers)
        self.assertEqual(manifest.status_code, 200)
        self.assertEqual(manifest.json()["engineVersion"], "1.19.0")
        self.assertEqual(manifest.json()["profileMode"], "adapter-governed-asset-inspection")

        suite = {
            "name": "kyc",
            "description": "PAN required",
            "expectations": [
                {
                    "type": "expect_column_values_to_not_be_null",
                    "kwargs": {"column": "pan"},
                }
            ],
        }
        created = self.client.post("/v1/suites", headers=self.headers, json=suite)
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(created.json()["version"], 1)
        self.assertEqual(len(self.client.get("/v1/suites", headers=self.headers).json()["suites"]), 1)

        asset = self.root / "tenants" / "org_bharat" / "assets" / "warehouse" / "customers.jsonl"
        asset.parent.mkdir(parents=True)
        asset.write_text("\n".join(json.dumps(row) for row in [{"pan": "ABCDE1234F"}, {"pan": None}]))
        profile = self.client.post(
            "/v1/profiles",
            headers=self.headers,
            json={"dataSourceId": "warehouse", "assetName": "customers", "sampleLimit": 100},
        )
        self.assertEqual(profile.status_code, 200, profile.text)
        self.assertEqual(profile.json()["sampledRows"], 2)

        passed = self.client.post(
            "/v1/validations",
            headers=self.headers,
            json={
                "suiteName": "kyc",
                "batch": {"kind": "inline", "rows": [{"pan": "ABCDE1234F"}]},
                "idempotencyKey": "pass_1",
            },
        )
        self.assertEqual(passed.status_code, 201, passed.text)
        self.assertTrue(passed.json()["success"])
        failed = self.client.post(
            "/v1/validations",
            headers=self.headers,
            json={
                "suiteName": "kyc",
                "batch": {"kind": "asset", "dataSourceId": "warehouse", "assetName": "customers", "limit": 100},
                "idempotencyKey": "fail_1",
            },
        )
        self.assertEqual(failed.status_code, 201, failed.text)
        self.assertFalse(failed.json()["success"])

        history = self.client.get("/v1/validations?limit=50", headers=self.headers)
        self.assertEqual(history.status_code, 200)
        self.assertEqual(len(history.json()["runs"]), 2)
        other = {**self.headers, "x-offgrid-org-id": "org_other"}
        self.assertEqual(self.client.get("/v1/validations?limit=50", headers=other).json()["runs"], [])

        updated = self.client.patch(
            "/v1/suites/kyc",
            headers=self.headers,
            json={"expectedVersion": 1, "description": "Updated"},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["version"], 2)
        self.assertEqual(
            self.client.delete("/v1/suites/kyc?expectedVersion=2", headers=self.headers).status_code,
            204,
        )
        self.assertEqual(self.client.get("/v1/suites", headers=self.headers).json()["suites"], [])

    def test_malformed_and_provider_errors_are_bounded(self) -> None:
        malformed = self.client.post("/v1/suites", headers=self.headers, json={"name": "kyc"})
        self.assertEqual(malformed.status_code, 422)
        missing = self.client.post(
            "/v1/profiles",
            headers=self.headers,
            json={"dataSourceId": "warehouse", "assetName": "missing", "sampleLimit": 100},
        )
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json(), {"error": "governed data asset not found."})

    def test_legacy_checkpoint_executes_and_retains_real_gx_119_results(self) -> None:
        passing = self.client.post(
            "/checkpoint/existing-flow",
            json={
                "rows": [{"pan": "ABCDE1234F"}],
                "expectations": [
                    {"type": "expect_column_values_to_not_be_null", "column": "pan"}
                ],
            },
        )
        self.assertEqual(passing.status_code, 200, passing.text)
        self.assertTrue(passing.json()["success"])
        self.assertEqual(passing.json()["engine"], "great-expectations")
        self.assertEqual(passing.json()["engineVersion"], "1.19.0")

        failing = self.client.post(
            "/checkpoint/existing-flow",
            json={
                "rows": [{"pan": None}],
                "expectations": [
                    {"type": "expect_column_values_to_not_be_null", "column": "pan"}
                ],
            },
        )
        self.assertEqual(failing.status_code, 200, failing.text)
        self.assertFalse(failing.json()["success"])
        self.assertEqual(failing.json()["failed"][0]["unexpected_count"], 1)
        retained = app_module.gx_lifecycle().context("legacy_internal").stores[
            "validation_results_store"
        ]
        self.assertEqual(len(retained.list_keys()), 2)

    def test_legacy_checkpoint_fails_closed_when_gx_cannot_persist(self) -> None:
        blocked_state_root = self.root / "blocked"
        app_module.lifecycle = GxLifecycle(blocked_state_root)
        (blocked_state_root / "tenants").write_text("not a directory")

        response = self.client.post(
            "/checkpoint/existing-flow",
            json={
                "rows": [{"pan": "ABCDE1234F"}],
                "expectations": [
                    {"type": "expect_column_values_to_not_be_null", "column": "pan"}
                ],
            },
        )

        self.assertEqual(response.status_code, 502, response.text)
        self.assertEqual(response.json(), {"error": "GX checkpoint execution failed."})


if __name__ == "__main__":
    unittest.main()
