#!/usr/bin/env bash
# Checks what run.sh hands to the CLI, with a stand-in that prints its arguments.
# Run: bash actions/nebuladb/run.test.sh
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cat >"$work/fake" <<'FAKE'
#!/usr/bin/env bash
printf 'ARGS:%s\n' "$*"
[ -z "${NEBULADB_API_KEY:-}" ] || echo "KEY_IN_ENV"
exit "${FAKE_EXIT:-0}"
FAKE
chmod +x "$work/fake"

fail=0
check() { # name, expected exit, expected output fragment, then env assignments...
  local name="$1" want_code="$2" want="$3"
  shift 3
  local out code
  out=$(env -i PATH="$PATH" RUNNER_TEMP="$work" GITHUB_OUTPUT="$work/out" GITHUB_STEP_SUMMARY="$work/summary" \
    NEBULADB_BIN="$work/fake" NEBULADB_API_KEY=secret "$@" bash "$here/run.sh" 2>&1)
  code=$?
  if [ "$code" != "$want_code" ] || ! grep -qF -- "$want" <<<"$out"; then
    echo "FAIL $name: exit $code, wanted $want_code and '$want'"
    echo "$out"
    fail=1
  else
    echo "ok   $name"
  fi
}

check "lint" 0 "ARGS:lint p1 --fail-on error --json-file" INPUT_COMMAND=lint INPUT_PROJECT=p1
check "lint on warnings" 0 "--fail-on warning" INPUT_COMMAND=lint INPUT_PROJECT=p1 INPUT_FAIL_ON=warning
check "lint bad fail-on" 2 "fail-on must be" INPUT_COMMAND=lint INPUT_PROJECT=p1 INPUT_FAIL_ON=nope
check "drift" 0 "ARGS:drift check p1 --json-file" INPUT_COMMAND=drift-check INPUT_PROJECT=p1
check "drift ignoring unreachable" 0 "--ignore-unreachable" INPUT_COMMAND=drift-check INPUT_PROJECT=p1 INPUT_IGNORE_UNREACHABLE=true
check "plan" 0 "ARGS:deploy plan p1 c1 --json-file" INPUT_COMMAND=deploy-plan INPUT_PROJECT=p1 INPUT_CONNECTION=c1
check "plan without a connection" 2 "connection is required" INPUT_COMMAND=deploy-plan INPUT_PROJECT=p1
check "deploy" 0 "ARGS:deploy run p1 c1 --resolutions r.json --confirm-name Shop live --no-backup --insecure" \
  INPUT_COMMAND=deploy INPUT_PROJECT=p1 INPUT_CONNECTION=c1 INPUT_RESOLUTIONS_FILE=r.json "INPUT_CONFIRM_NAME=Shop live" INPUT_NO_BACKUP=true INPUT_INSECURE=true
check "the key is only in the environment" 0 "KEY_IN_ENV" INPUT_COMMAND=lint INPUT_PROJECT=p1
check "the CLI's exit code is the step's" 1 "ARGS:lint" INPUT_COMMAND=lint INPUT_PROJECT=p1 FAKE_EXIT=1
check "unknown command" 2 "command must be" INPUT_COMMAND=explode INPUT_PROJECT=p1

grep -q "exit-code=1" "$work/out" && grep -q "result=" "$work/out" && echo "ok   outputs written" || { echo "FAIL outputs"; fail=1; }
if grep -q "secret" "$work/summary" "$work/out"; then echo "FAIL the key leaked into the outputs"; fail=1; fi
exit $fail
