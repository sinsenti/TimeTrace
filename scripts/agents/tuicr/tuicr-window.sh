#!/usr/bin/env bash
# Open tuicr in a NEW tmux window (not a split pane) to review a branch before it
# merges to dev, and return immediately so the agent can keep working.
#
# The sibling tuicr-wrapper.sh splits the current window and BLOCKS until tuicr
# exits. That is wrong for the pre-merge flow: the review window should persist
# next to your work, and the agent should poll `tuicr review comments` for the
# feedback rather than sitting on a blocked shell.
set -euo pipefail

TUICR_WINDOW_NAME="${TUICR_WINDOW_NAME:-review}"
BASE_BRANCH="${TT_BASE_BRANCH:-dev}"

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; NC=$'\033[0m'
info() { printf '%s[tuicr]%s %s\n' "$GREEN" "$NC" "$*"; }
warn() { printf '%s[tuicr]%s %s\n' "$YELLOW" "$NC" "$*"; }
err()  { printf '%s[tuicr]%s %s\n' "$RED" "$NC" "$*" >&2; }

usage() {
  cat <<EOF
Usage: $(basename "$0") [directory] [-- tuicr-args...]

Open tuicr in a new tmux window to review changes.

Arguments:
  directory     Repo (or worktree) to review. Default: current directory.
  tuicr-args    Passed through to tuicr, e.g. -w for the working tree,
                or -r <revset> for a commit range.

Environment:
  TUICR_WINDOW_NAME   tmux window name (default: review)
  TT_BASE_BRANCH      Branch to diff against when no args given (default: dev)

Examples:
  $(basename "$0")                         # review this branch vs $BASE_BRANCH
  $(basename "$0") ~/git/TimeTrace-stats   # review a worktree vs $BASE_BRANCH
  $(basename "$0") . -- -w                 # review uncommitted work instead
EOF
}

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage; exit 0; }

command -v tuicr >/dev/null 2>&1 || { err "tuicr not found on PATH."; exit 1; }
[[ -n "${TMUX:-}" ]] || {
  err "Not inside tmux. Start your agent inside tmux, or run tuicr yourself in the repo."
  exit 1
}

target_dir="."
if [[ "${1:-}" != "--" && -n "${1:-}" ]]; then target_dir="$1"; shift; fi
[[ "${1:-}" == "--" ]] && shift
target_dir="$(cd "$target_dir" && pwd)"

git -C "$target_dir" rev-parse --git-dir >/dev/null 2>&1 \
  || { err "Not a git repository: $target_dir"; exit 1; }

# With no explicit tuicr args, scope the review to this branch's commits vs the
# base branch -- that is the thing actually being merged.
tuicr_args=("$@")
if (( ${#tuicr_args[@]} == 0 )); then
  current_branch="$(git -C "$target_dir" rev-parse --abbrev-ref HEAD)"
  if [[ "$current_branch" == "$BASE_BRANCH" ]]; then
    warn "Already on $BASE_BRANCH; reviewing uncommitted working-tree changes instead."
    tuicr_args=(-w)
  elif git -C "$target_dir" rev-parse --verify "$BASE_BRANCH" >/dev/null 2>&1; then
    ahead="$(git -C "$target_dir" rev-list --count "${BASE_BRANCH}..HEAD")"
    if [[ "$ahead" == "0" ]]; then
      warn "$current_branch has no commits beyond $BASE_BRANCH; reviewing working tree."
      tuicr_args=(-w)
    else
      info "Reviewing $ahead commit(s) on $current_branch vs $BASE_BRANCH"
      tuicr_args=(-r "${BASE_BRANCH}..HEAD")
    fi
  else
    warn "Base branch $BASE_BRANCH not found; reviewing working tree."
    tuicr_args=(-w)
  fi
fi

printf -v cmd 'cd %q && exec tuicr' "$target_dir"
for a in "${tuicr_args[@]}"; do printf -v cmd '%s %q' "$cmd" "$a"; done

# -d: create without stealing focus. exec: no shell survives tuicr, so the window
# closes itself on quit.
window_id="$(tmux new-window -d -P -F '#{window_id}' \
  -n "$TUICR_WINDOW_NAME" -c "$target_dir" "$cmd")"

info "tuicr opened in tmux window $window_id (\"$TUICR_WINDOW_NAME\")"
info "Switch to it with: tmux select-window -t $window_id   (or your prefix + window number)"
echo
echo "=== TUICR WINDOW ==="
echo "$window_id"
echo "=== END TUICR WINDOW ==="
echo
info "Read feedback with: tuicr review list --repo $target_dir"
info "                    tuicr review comments --repo $target_dir --session <slug>"
