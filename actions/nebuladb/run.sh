#!/usr/bin/env bash
# Runs one NebulaDB CLI command from the action's inputs (INPUT_* variables).
# The API key reaches the CLI through NEBULADB_API_KEY only, never as an argument.
set -uo pipefail

: "${NEBULADB_BIN:?}" "${INPUT_COMMAND:?}" "${INPUT_PROJECT:?}"
output_file="${GITHUB_OUTPUT:-/dev/null}"
summary_file="${GITHUB_STEP_SUMMARY:-/dev/null}"
result="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/nebuladb-result-$$.json"
text="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/nebuladb-text-$$.txt"

is_true() { [ "${1:-}" = "true" ]; }
usage() {
  echo "::error::$1" >&2
  echo "exit-code=2" >>"$output_file"
  exit 2
}
need() { [ -n "${!1:-}" ] || usage "$2"; }

args=()
case "$INPUT_COMMAND" in
  lint)
    args=(lint "$INPUT_PROJECT")
    case "${INPUT_FAIL_ON:-error}" in
      error | warning) args+=(--fail-on "${INPUT_FAIL_ON:-error}") ;;
      *) usage "fail-on must be error or warning" ;;
    esac
    ;;
  drift-check)
    args=(drift check "$INPUT_PROJECT")
    if is_true "${INPUT_IGNORE_UNREACHABLE:-}"; then args+=(--ignore-unreachable); fi
    ;;
  deploy-plan | deploy)
    need INPUT_CONNECTION "connection is required for $INPUT_COMMAND"
    if [ "$INPUT_COMMAND" = "deploy" ]; then args=(deploy run); else args=(deploy plan); fi
    args+=("$INPUT_PROJECT" "$INPUT_CONNECTION")
    if [ -n "${INPUT_RESOLUTIONS_FILE:-}" ]; then args+=(--resolutions "$INPUT_RESOLUTIONS_FILE"); fi
    if [ "$INPUT_COMMAND" = "deploy" ]; then
      if [ -n "${INPUT_CONFIRM_NAME:-}" ]; then args+=(--confirm-name "$INPUT_CONFIRM_NAME"); fi
      if is_true "${INPUT_NO_BACKUP:-}"; then args+=(--no-backup); fi
    fi
    ;;
  *) usage "command must be lint, drift-check, deploy-plan or deploy" ;;
esac
if is_true "${INPUT_INSECURE:-}"; then args+=(--insecure); fi
args+=(--json-file "$result")

# shellcheck disable=SC2086 # NEBULADB_BIN is "node <path>" or a command name
$NEBULADB_BIN "${args[@]}" 2>&1 | tee "$text"
code=${PIPESTATUS[0]}

{
  echo "result=$result"
  echo "exit-code=$code"
} >>"$output_file"
{
  echo "### NebulaDB: \`${args[*]:0:2}\` — exit code $code"
  echo '```'
  cat "$text"
  echo '```'
} >>"$summary_file"
exit "$code"
