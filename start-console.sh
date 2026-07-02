#!/bin/bash
# Off Grid console launcher (co.getoffgridai.console). `next start` needs node on
# PATH and auto-loads .env / .env.local from cwd (AUTH_* + Keycloak live there).
cd /Users/admin/offgrid/console || exit 1
export PATH=/usr/local/bin:$PATH
exec npm start
