#!/usr/bin/env bash
# Manage isolated TimeTrace feature worktrees.
#
# Each worktree gets its own checkout, its own .venv, its own scratch database and
# its own daemon port, so several features can be built and run at the same time
# without colliding with each other or with the user's real data on port 8002.
set -euo pipefail

MAIN_REPO="${TT_MAIN_REPO:-$HOME/git/TimeTrace}"
WORKTREE_PREFIX="${TT_WORKTREE_PREFIX:-$HOME/git/TimeTrace-}"
REAL_DB="${TT_REAL_DB:-$HOME/.timetrace/timetrace.db}"
SCRATCH_DB_DIR="${TT_SCRATCH_DB_DIR:-$HOME/.timetrace/worktrees}"
BASE_BRANCH="${TT_BASE_BRANCH:-dev}"
PORT_START="${TT_PORT_START:-8011}"
PORT_END="${TT_PORT_END:-8060}"

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; NC=$'\033[0m'
info() { printf '%s[tt-worktree]%s %s\n' "$GREEN" "$NC" "$*"; }
warn() { printf '%s[tt-worktree]%s %s\n' "$YELLOW" "$NC" "$*"; }
err()  { printf '%s[tt-worktree]%s %s\n' "$RED" "$NC" "$*" >&2; }

usage() {
  cat <<EOF
Usage: $(basename "$0") <command> [args]

Commands:
  new <feature> [--empty]   Create worktree + branch feat/<feature>, scratch DB, free port
  list                      Show every worktree with its branch, port, DB and dirty state
  env <feature>             Print the path of the worktree's .tt-env (source it to use)
  rm <feature> [--force]    Remove the worktree and its scratch DB (branch is kept)

Notes:
  'new' seeds the scratch DB from a COPY of $REAL_DB so features are developed
  against realistic data. Pass --empty for a blank DB built by migrations instead.
  The real database is never opened by a worktree daemon.
EOF
}

slug_of() { printf '%s' "$1" | tr -c 'a-zA-Z0-9._-' '-' | sed 's/^-*//; s/-*$//'; }

port_in_use() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -q ":${p}\b" && return 0
  fi
  # Also treat a port already recorded by another worktree as taken.
  grep -rqs "TIMETRACE_PORT=${p}$" "${WORKTREE_PREFIX}"*/.tt-env 2>/dev/null && return 0
  return 1
}

find_free_port() {
  local p
  for (( p=PORT_START; p<=PORT_END; p++ )); do
    if ! port_in_use "$p"; then printf '%s' "$p"; return 0; fi
  done
  err "No free port in ${PORT_START}-${PORT_END}"; return 1
}

cmd_new() {
  local feature="${1:-}"; shift || true
  [[ -n "$feature" ]] || { err "Need a feature name"; usage; exit 1; }
  local empty=0
  [[ "${1:-}" == "--empty" ]] && empty=1

  local slug; slug="$(slug_of "$feature")"
  local dir="${WORKTREE_PREFIX}${slug}"
  local branch="feat/${slug}"

  [[ -e "$dir" ]] && { err "Already exists: $dir"; exit 1; }

  local port; port="$(find_free_port)"
  local db="${SCRATCH_DB_DIR}/${slug}.db"
  mkdir -p "$SCRATCH_DB_DIR"

  info "Creating worktree $dir on $branch (from $BASE_BRANCH)"
  git -C "$MAIN_REPO" worktree add -b "$branch" "$dir" "$BASE_BRANCH"

  if (( empty )); then
    rm -f "$db"
    info "Scratch DB will be created empty by migrations: $db"
  else
    if [[ -f "$REAL_DB" ]]; then
      cp "$REAL_DB" "$db"
      info "Scratch DB seeded from a copy of the real DB: $db"
    else
      warn "Real DB not found at $REAL_DB; starting empty"
      rm -f "$db"
    fi
  fi

  cat > "${dir}/.tt-env" <<EOF
# Source this before running anything in this worktree:  source .tt-env
# Keeps this feature's daemon off port 8002 and away from the real database.
export TIMETRACE_DB_FILE=${db}
export TIMETRACE_PORT=${port}
EOF

  info "Running uv sync"
  (cd "$dir" && uv sync >/dev/null)

  cat <<EOF

  worktree : $dir
  branch   : $branch
  port     : $port
  database : $db

  cd $dir && source .tt-env && uv run timetrace daemon

EOF
}

cmd_list() {
  printf '%-34s %-26s %-6s %-8s %s\n' WORKTREE BRANCH PORT STATE DATABASE
  git -C "$MAIN_REPO" worktree list --porcelain \
  | awk '/^worktree /{w=$2} /^branch /{b=$2; print w"\t"b}' \
  | while IFS=$'\t' read -r wt br; do
      local_port=""; local_db=""
      if [[ -f "${wt}/.tt-env" ]]; then
        local_port="$(sed -n 's/^export TIMETRACE_PORT=//p' "${wt}/.tt-env")"
        local_db="$(sed -n 's/^export TIMETRACE_DB_FILE=//p' "${wt}/.tt-env")"
      fi
      [[ "$wt" == "$MAIN_REPO" ]] && { local_port="8002"; local_db="$REAL_DB (REAL)"; }
      state="clean"
      git -C "$wt" diff --quiet 2>/dev/null || state="dirty"
      [[ -n "$(git -C "$wt" ls-files --others --exclude-standard 2>/dev/null)" ]] && state="dirty"
      printf '%-34s %-26s %-6s %-8s %s\n' \
        "$(basename "$wt")" "${br#refs/heads/}" "${local_port:-–}" "$state" "${local_db:-–}"
    done
}

cmd_env() {
  local slug; slug="$(slug_of "${1:?need a feature name}")"
  local f="${WORKTREE_PREFIX}${slug}/.tt-env"
  [[ -f "$f" ]] || { err "No .tt-env at $f"; exit 1; }
  printf '%s\n' "$f"
}

cmd_rm() {
  local slug; slug="$(slug_of "${1:?need a feature name}")"; shift || true
  local dir="${WORKTREE_PREFIX}${slug}"
  [[ -d "$dir" ]] || { err "No worktree at $dir"; exit 1; }

  if ! git -C "$dir" diff --quiet 2>/dev/null \
     || [[ -n "$(git -C "$dir" ls-files --others --exclude-standard 2>/dev/null)" ]]; then
    if [[ "${1:-}" != "--force" ]]; then
      err "$dir has uncommitted changes. Commit them, or re-run with --force to discard."
      git -C "$dir" status --short
      exit 1
    fi
    warn "Discarding uncommitted changes in $dir (--force)"
  fi

  git -C "$MAIN_REPO" worktree remove ${1:+--force} "$dir"
  rm -f "${SCRATCH_DB_DIR}/${slug}.db"
  info "Removed $dir and its scratch DB. Branch feat/${slug} was kept."
}

case "${1:-}" in
  new)  shift; cmd_new "$@" ;;
  list) shift; cmd_list "$@" ;;
  env)  shift; cmd_env "$@" ;;
  rm)   shift; cmd_rm "$@" ;;
  -h|--help|"") usage ;;
  *) err "Unknown command: $1"; usage; exit 1 ;;
esac
