# OpenBao — PERSISTENT server config (production).
#
# Replaces dev mode (in-memory, hardcoded root token) — the P0 from the production-readiness
# audit: in dev mode EVERY restart wipes all secrets (connector creds, webhook-trigger secrets,
# the Resend API key, gateway keys). File storage persists them to a mounted volume.
#
# APPLYING THIS IS SUPERVISED (it re-initialises the vault — see the runbook in
# deploy/onprem/SERVER_STATE.md § "OpenBao persistence migration"). On first boot the vault comes
# up SEALED and must be `bao operator init` + unsealed; the unseal keys + a fresh root token are
# generated then (founder holds unseal-key custody). After that, wire the console's
# OFFGRID_OPENBAO_TOKEN to a scoped token (not the root) and include /openbao/data in backups.

storage "file" {
  path = "/openbao/data"
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = true # TLS terminates at the Caddy edge / loopback-only exposure; not on the vault socket.
}

# IPC_LOCK cap is granted in compose so mlock works (keeps secrets off swap). If a host can't grant
# it, set disable_mlock = true — less secure, documented tradeoff.
disable_mlock = false

api_addr = "http://127.0.0.1:8200"
ui       = false
