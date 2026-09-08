#!/usr/bin/env bash
# Post-deployment verification.
#
# Checks only what can be checked without an account: that the service is up,
# that it can reach its database, that migrations have run, that the app shell
# is served, and that protected routes actually refuse anonymous callers.
#
# Usage: scripts/smoke.sh https://your-service.onrender.com

set -euo pipefail

BASE="${1:-http://localhost:4000}"
fail=0

check() {
  local label="$1" expected="$2" url="$3"
  local code
  # curl already emits 000 when it cannot connect, so no fallback is needed.
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url") || true
  if [ "$code" = "$expected" ]; then
    printf '  ok    %-42s %s\n' "$label" "$code"
  else
    printf '  FAIL  %-42s got %s, expected %s\n' "$label" "$code" "$expected"
    fail=1
  fi
}

echo "Smoke testing $BASE"
check "liveness"                    200 "$BASE/health"
check "readiness (db + migrations)" 200 "$BASE/readiness"
check "app shell served"            200 "$BASE/"
check "client route falls through"  200 "$BASE/welcome"
check "unknown API route is 404"    404 "$BASE/api/v1/does-not-exist"
check "protected route refuses"     401 "$BASE/api/v1/auth/me"

echo
echo "readiness detail:"
curl -s --max-time 20 "$BASE/readiness" || true
echo

if [ "$fail" -ne 0 ]; then
  echo
  echo "SMOKE TEST FAILED"
  exit 1
fi
echo
echo "All smoke checks passed."
