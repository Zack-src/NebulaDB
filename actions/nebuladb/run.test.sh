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
cat >"$work/gh" <<'GH'
#!/usr/bin/env bash
echo "GH:$*" >>"$GH_LOG"
case "$*" in
  *--paginate*) [ -z "${FAKE_GH_EXISTING:-}" ] || echo "${FAKE_GH_EXISTING}" ;;
  *body=@*) cat "${*##*body=@}" >>"$GH_LOG" ;;
esac
exit "${FAKE_GH_EXIT:-0}"
GH
chmod +x "$work/fake" "$work/gh"

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

check "lint-file needs no project, url or key" 0 "ARGS:lint ./schema --format markdown --fail-on error --json-file" INPUT_COMMAND=lint-file INPUT_FILE=schema
check "lint-file keeps a path" 0 "ARGS:lint db/schema.dbml --format markdown" INPUT_COMMAND=lint-file INPUT_FILE=db/schema.dbml
check "lint-file without a file" 2 "file is required" INPUT_COMMAND=lint-file
check "diff with a base file" 0 "ARGS:diff old.dbml new.dbml --format markdown --exit-code --json-file" INPUT_COMMAND=diff INPUT_FILE=new.dbml INPUT_BASE_FILE=old.dbml INPUT_FAIL_ON_CHANGES=true
check "diff without a base" 2 "diff needs base-file or base-ref" INPUT_COMMAND=diff INPUT_FILE=new.dbml
check "diff with an unreadable ref" 2 "cannot read new.dbml at no-such-ref" INPUT_COMMAND=diff INPUT_FILE=new.dbml INPUT_BASE_REF=no-such-ref

# The sticky comment: one is created, then that same one is updated, never a second.
export GH_LOG="$work/gh.log"
: >"$GH_LOG"
pr_env=(PATH="$work:$PATH" GH_LOG="$GH_LOG" GITHUB_REPOSITORY=o/r INPUT_PR_NUMBER=42)
check "comment creates when there is none" 0 "ARGS:lint" "${pr_env[@]}" INPUT_COMMAND=lint-file INPUT_FILE=s.dbml INPUT_COMMENT=true
if grep -q "GH:api --method POST repos/o/r/issues/42/comments" "$GH_LOG" && grep -q "<!-- nebuladb-action:lint-file -->" "$GH_LOG"; then
  echo "ok   comment posted with its marker"
else
  echo "FAIL comment create"
  cat "$GH_LOG"
  fail=1
fi
: >"$GH_LOG"
check "comment updates the existing one" 0 "ARGS:lint" "${pr_env[@]}" FAKE_GH_EXISTING=777 INPUT_COMMAND=lint-file INPUT_FILE=s.dbml INPUT_COMMENT=true INPUT_COMMENT_TAG=mine
if grep -q "GH:api --method PATCH repos/o/r/issues/comments/777" "$GH_LOG" && ! grep -q "method POST" "$GH_LOG" && grep -q "nebuladb-action:mine" "$GH_LOG"; then
  echo "ok   comment updated in place"
else
  echo "FAIL comment update"
  cat "$GH_LOG"
  fail=1
fi
check "a failed comment only warns" 0 "could not post the pull-request comment" "${pr_env[@]}" FAKE_GH_EXIT=1 INPUT_COMMAND=lint-file INPUT_FILE=s.dbml INPUT_COMMENT=true
check "no comment outside a pull request" 0 "comment skipped" PATH="$work:$PATH" GH_LOG="$GH_LOG" GITHUB_REPOSITORY=o/r INPUT_COMMAND=lint-file INPUT_FILE=s.dbml INPUT_COMMENT=true
printf 'exit-code=1\nresult=x\n' >"$work/out"

grep -q "exit-code=1" "$work/out" && grep -q "result=" "$work/out" && echo "ok   outputs written" || { echo "FAIL outputs"; fail=1; }
if grep -q "secret" "$work/summary" "$work/out"; then echo "FAIL the key leaked into the outputs"; fail=1; fi
exit $fail
