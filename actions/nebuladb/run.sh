#!/usr/bin/env bash
# Runs one NebulaDB CLI command from the action's inputs (INPUT_* variables).
# The API key reaches the CLI through NEBULADB_API_KEY only, never as an argument.
set -uo pipefail

: "${NEBULADB_BIN:?}" "${INPUT_COMMAND:?}"
output_file="${GITHUB_OUTPUT:-/dev/null}"
summary_file="${GITHUB_STEP_SUMMARY:-/dev/null}"
scratch="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
result="$scratch/nebuladb-result-$$.json"
text="$scratch/nebuladb-text-$$.txt"

is_true() { [ "${1:-}" = "true" ]; }
usage() {
  echo "::error::$1" >&2
  echo "exit-code=2" >>"$output_file"
  exit 2
}
need() { [ -n "${!1:-}" ] || usage "$2"; }

# lint-file and diff run on files of the workspace: no instance, no key, no project.
offline=false
case "$INPUT_COMMAND" in
  lint-file | diff) offline=true ;;
  *) need INPUT_PROJECT "project is required for $INPUT_COMMAND" ;;
esac

# A bare name would be taken for a project id by the CLI: make it a path.
as_path() {
  case "$1" in
    */* | *.dbml) printf '%s' "$1" ;;
    *) printf './%s' "$1" ;;
  esac
}

args=()
case "$INPUT_COMMAND" in
  lint)
    args=(lint "$INPUT_PROJECT")
    case "${INPUT_FAIL_ON:-error}" in
      error | warning) args+=(--fail-on "${INPUT_FAIL_ON:-error}") ;;
      *) usage "fail-on must be error or warning" ;;
    esac
    ;;
  lint-file)
    need INPUT_FILE "file is required for lint-file"
    args=(lint "$(as_path "$INPUT_FILE")" --format markdown)
    case "${INPUT_FAIL_ON:-error}" in
      error | warning) args+=(--fail-on "${INPUT_FAIL_ON:-error}") ;;
      *) usage "fail-on must be error or warning" ;;
    esac
    ;;
  diff)
    need INPUT_FILE "file is required for diff"
    base="${INPUT_BASE_FILE:-}"
    if [ -z "$base" ]; then
      [ -n "${INPUT_BASE_REF:-}" ] || usage "diff needs base-file or base-ref"
      base="$scratch/nebuladb-base-$$.dbml"
      git show "${INPUT_BASE_REF}:${INPUT_FILE#./}" >"$base" 2>/dev/null ||
        usage "cannot read ${INPUT_FILE} at ${INPUT_BASE_REF} (check out with fetch-depth: 0, or fetch that ref)"
    fi
    args=(diff "$(as_path "$base")" "$(as_path "$INPUT_FILE")" --format markdown)
    if is_true "${INPUT_FAIL_ON_CHANGES:-}"; then args+=(--exit-code); fi
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
  *) usage "command must be lint, lint-file, diff, drift-check, deploy-plan or deploy" ;;
esac
if ! $offline && is_true "${INPUT_INSECURE:-}"; then args+=(--insecure); fi
args+=(--json-file "$result")

# shellcheck disable=SC2086 # NEBULADB_BIN is "node <path>" or a command name
$NEBULADB_BIN "${args[@]}" 2>&1 | tee "$text"
code=${PIPESTATUS[0]}

{
  echo "result=$result"
  echo "exit-code=$code"
} >>"$output_file"
if $offline; then
  cat "$text" >>"$summary_file"
else
  {
    echo "### NebulaDB: \`${args[*]:0:2}\` — exit code $code"
    echo '```'
    cat "$text"
    echo '```'
  } >>"$summary_file"
fi

# One sticky pull-request comment, found again by a hidden marker and updated in place.
post_comment() {
  local repo="${GITHUB_REPOSITORY:-}" pr="${INPUT_PR_NUMBER:-}"
  local marker="<!-- nebuladb-action:${INPUT_COMMENT_TAG:-$INPUT_COMMAND} -->"
  if [ -z "$pr" ] && [ -f "${GITHUB_EVENT_PATH:-}" ]; then
    pr=$(jq -r '.pull_request.number // empty' "$GITHUB_EVENT_PATH" 2>/dev/null)
  fi
  if [ -z "$repo" ] || [ -z "$pr" ]; then
    echo "::notice::comment skipped: this is not a pull request run (set pr-number to force one)"
    return 0
  fi
  local body="$scratch/nebuladb-comment-$$.md"
  {
    echo "$marker"
    if $offline; then
      cat "$text"
    else
      echo "### NebulaDB \`$INPUT_COMMAND\`: exit code $code"
      echo '```'
      cat "$text"
      echo '```'
    fi
  } >"$body"
  local existing
  existing=$(gh api --paginate "repos/$repo/issues/$pr/comments" \
    --jq ".[] | select(.body | contains(\"$marker\")) | .id" 2>/dev/null | head -n 1)
  local status=0
  if [ -n "$existing" ]; then
    gh api --method PATCH "repos/$repo/issues/comments/$existing" -F "body=@$body" >/dev/null || status=$?
  else
    gh api --method POST "repos/$repo/issues/$pr/comments" -F "body=@$body" >/dev/null || status=$?
  fi
  if [ "$status" != 0 ]; then
    echo "::warning::could not post the pull-request comment (it needs pull-requests: write; a fork's token is read-only)"
  fi
}
if is_true "${INPUT_COMMENT:-}"; then post_comment; fi
exit "$code"
