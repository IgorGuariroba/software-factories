#!/bin/sh
# Lint/format helper for hooks without a hook manager (.githooks/). Sourced by pre-commit after the branch check:
#   . "$(dirname "$0")/staged.sh"
#   run_staged 'npx --no-install eslint --max-warnings=0' '*.js' '*.ts' || exit 1
#   run_staged 'ruff format --check' '*.py' || exit 1
# run_staged <command> <pathspec>...
#   - passes only the staged files (added, copied, modified, renamed; never deleted) to <command>, NUL-safe;
#   - refuses when one of them also has unstaged changes: the linter reads the working tree, so it would check
#     something other than what is committed (stage it fully, or git stash push --keep-index first);
#   - returns 0 when no staged file matches.
# With a hook manager use its own mechanism instead: lint-staged/nano-staged, lefthook {staged_files} with
# stage_fixed, the pre-commit framework's filename passing. They stash unstaged changes themselves.

run_staged() {
  _cmd=$1; shift
  _list=$(mktemp) || return 1
  git diff --cached --name-only -z --diff-filter=ACMR -- "$@" >"$_list"
  if [ ! -s "$_list" ]; then rm -f "$_list"; return 0; fi
  _partial=$(xargs -0 git diff --name-only -- <"$_list")
  if [ -n "$_partial" ]; then
    rm -f "$_list"
    {
      echo "✋ Partially staged files: the check would read the working tree, not what you commit:"
      printf '%s\n' "$_partial" | sed 's/^/   /'
      echo "   Stage them fully (git add), or: git stash push --keep-index && git commit && git stash pop"
    } >&2
    return 1
  fi
  # shellcheck disable=SC2016
  xargs -0 sh -c "$_cmd"' "$@"' sh <"$_list"
  _rc=$?
  rm -f "$_list"
  [ $_rc -eq 0 ] || echo "✋ '$_cmd' failed on staged files (bypass: git commit --no-verify)" >&2
  return $_rc
}
