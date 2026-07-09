# OpenBao persistent config for the offgrid-services-a stack (S1). File storage on the openbaodata
# volume so secrets survive restarts (was BAO_DEV in-memory). Comes up SEALED; the boot auto-unseal
# job (deploy/openbao/auto-unseal.sh + launchd plist) feeds the Shamir keys. TLS terminates at the
# loopback/edge — the vault socket is loopback-bound, not exposed to the tunnel/LAN.
storage "file" {
  path = "/openbao/data"
}
listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = true
}
api_addr = "http://127.0.0.1:8200"
ui       = false
