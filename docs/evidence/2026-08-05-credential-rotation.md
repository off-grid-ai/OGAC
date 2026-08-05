# Live proof — a source credential can be vaulted and rotated

**Date:** 2026-08-05 · **Box:** on-prem (S1) · **Fixture:** Policy Administration (MySQL 8.4.10)
**Connector:** `con_policyadmin` (org `default`)

The `connector-lifecycle` rows across the four enterprise fixtures all said the same thing: the
fixture works, but *"full fixture lifecycle and credential rotation are not fleet-proven"*.

## What the fixtures actually looked like

```
con_policyadmin     | mysql://policyadmin:policyadmin@127.0.0.1:3307/policyadmin | secret_ref: null
surcon_policyadmin  | mysql://policyadmin:policyadmin@127.0.0.1:3307/suraksha    | secret_ref: null
bhcon_policyadmin   | mysql://policyadmin:policyadmin@127.0.0.1:3307/policyadmin | secret_ref: null
```

**The password is inline in the endpoint, in the `connectors` table — not in the vault.** That is what
"seeded outside the public self-serve validation path" means in practice, and it is worth saying in
plain terms rather than leaving in the gap text. One connector (`con_f5c959`, created 2026-07-17) does
use the recommended shape — a credential-free endpoint plus an org-scoped vault reference — and it
works, so the supported path is real; the seeds just do not use it.

## The drill

1. **Baseline** — connects with the inline credential. ✅
2. **Vault it** — password written to OpenBao, endpoint rewritten credential-free:
   ```
   endpoint now: mysql://policyadmin@127.0.0.1:3307/policyadmin
   secret_ref:   connectors/con_policyadmin/credential
   vault holds the password: true
   → connects OK
   ```
3. **Rotate** — changed the password in MySQL first, and checked the STALE vault entry before updating
   it, because a rotation that is never observed failing has not been shown to be doing anything:
   ```
   BEFORE updating the vault:  REFUSED — Access denied for user 'policyadmin' (using password: YES)
   AFTER  updating the vault:  connects OK
   ```
   The refusal is the evidence. It proves the connection genuinely depends on the vaulted value rather
   than on something cached, inline, or ambient.
4. **Restore** — password back to the seeded value, vault entry removed, endpoint back to the original.
   All four connectors pointing at that MySQL user re-verified: **OK**.

## The mistake this drill made, and the fix

The first run put `FLUSH PRIVILEGES` after `ALTER USER`. MySQL 8 does not need it and the fixture user
lacks the privilege — so the drill **aborted between changing the database password and updating the
vault**, leaving the shared fixture user unusable by every connector pointing at it. The `catch`
restored the console row but not the database side, so the restore was useless.

Two rules came out of it, and both are now in the script:

- **The restore belongs in `finally`, not `catch`** — an abort is exactly when it is needed.
- **Restore the far side too.** Putting the console row back while leaving the database password
  changed is a restore that looks complete and fixes nothing.

A second, smaller error: the first verification probed every connector with `orgId: 'default'`, and
reported `con_f5c959` (an `org_bharat` connector) as broken. Vault paths are org-scoped, so the lookup
found nothing. **The connector was fine; the check was wrong** — a reminder that a red result from a
verification script needs the same scepticism as a green one.

## What this closes

Credential rotation is proven for the MySQL fixture: vaulted, rotated, observed failing on the stale
secret, and restored. The mechanism (`persistConnectorSecret` → OpenBao → `resolveConnectorTarget`
splices at query time) is shared by the Postgres, MSSQL and REST fixtures, but **this drill ran against
MySQL only**, so the other three rows stay `partial` rather than borrowing this evidence.

**Not closed:** the seeds still ship inline credentials. Moving them to vault references is a seeding
change, logged as **G-211**.
