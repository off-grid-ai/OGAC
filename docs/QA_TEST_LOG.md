# QA test log — founder-verifiable broken flows

Each bullet is a user flow + what breaks that the user sees. Verify each after a fix.

## Settings / Configuration

- [ ] Open Configuration, edit a host field (e.g. Qdrant URL) to a real LAN IP like `http://10.0.0.5:6333`, Save, reload → the saved value silently becomes `http://127.0.0.1:6333` (your address is discarded; on a box not co-located with S1 the service can no longer be reached after restart) (src/lib/config.ts:87, src/lib/display-host.ts | G-ADV-SET-1 / G-ADV-SET-3)
- [ ] Open Configuration where a host key was set to `192.168.1.59`, change nothing on it, edit + Save any host field, reload → its persisted value is rewritten to loopback `127.0.0.1` (src/lib/config.ts:57,87 | G-ADV-SET-1)
- [ ] Reveal (or GET /api/v1/admin/config/reveal) a host key like Gateway URL as admin → returns raw `http://127.0.0.1:4000` even though the config list shows `offgrid-s1.local:4000` for the same key (raw loopback exposed in the UI; two surfaces disagree) (src/app/api/v1/admin/config/reveal/route.ts:17, src/lib/config.ts:69 | G-ADV-SET-5)
- [ ] Edit a connector and set its type to something invalid, or paste a malformed endpoint, and Save → it persists with a success toast (no validation error), then the connector silently goes to an error/unreachable state — unlike Add Connector which rejects the same input (src/app/api/v1/admin/connectors/[id]/route.ts:16 | G-ADV-SET-4)
- [ ] Save an Org ROI default, stay on the page → the "Current: N min/run" label keeps showing the old value until a full reload, so you can't confirm the save took (src/components/insights/RoiOrgDefaults.tsx | G-ADV-SET-6)
