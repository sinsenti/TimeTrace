#!/usr/bin/env bash
# At-a-glance state of every TimeTrace worktree, daemon and open review.
# Run once, or `watch -c -n 5 .claude/scripts/tt-status.sh` in the central-chat window.
set -uo pipefail

MAIN_REPO="${TT_MAIN_REPO:-$HOME/git/TimeTrace}"
WORKTREE_PREFIX="${TT_WORKTREE_PREFIX:-$HOME/git/TimeTrace-}"
REAL_DB="${TT_REAL_DB:-$HOME/.timetrace/timetrace.db}"
BASE_BRANCH="${TT_BASE_BRANCH:-dev}"

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[0;31m'
GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; CYAN=$'\033[0;36m'; NC=$'\033[0m'

hr() { printf '%s%s%s\n' "$DIM" "$(printf '─%.0s' $(seq 1 82))" "$NC"; }

printf '%s TimeTrace %s%s\n' "$BOLD" "$(date '+%Y-%m-%d %H:%M:%S')" "$NC"
hr

# ---------- worktrees ----------
# Colour codes are counted by printf's width specifier, so every coloured field
# is padded as a plain string first and the colour applied around the result.
printf '%s%-26s %-24s %-6s %-7s %-8s %s%s\n' \
  "$BOLD" WORKTREE BRANCH PORT STATE "vs $BASE_BRANCH" "" "$NC"

git -C "$MAIN_REPO" worktree list --porcelain 2>/dev/null \
| awk '/^worktree /{w=$2} /^branch /{print w"\t"$2}' \
| while IFS=$'\t' read -r wt br; do
    br="${br#refs/heads/}"
    port="–"; is_main=0
    [[ "$wt" == "$MAIN_REPO" ]] && { port="8002"; is_main=1; }
    [[ -f "${wt}/.tt-env" ]] && port="$(sed -n 's/^export TIMETRACE_PORT=//p' "${wt}/.tt-env")"

    state="clean"; scolor="$GREEN"
    if ! git -C "$wt" diff --quiet 2>/dev/null \
       || [[ -n "$(git -C "$wt" ls-files --others --exclude-standard 2>/dev/null)" ]]; then
      state="dirty"; scolor="$YELLOW"
    fi

    delta="–"; dcolor=""
    if [[ "$br" != "$BASE_BRANCH" ]] && git -C "$wt" rev-parse --verify "$BASE_BRANCH" >/dev/null 2>&1; then
      ahead="$(git -C "$wt" rev-list --count "${BASE_BRANCH}..HEAD" 2>/dev/null || echo 0)"
      behind="$(git -C "$wt" rev-list --count "HEAD..${BASE_BRANCH}" 2>/dev/null || echo 0)"
      delta="+${ahead}/-${behind}"
      [[ "$ahead" != "0" ]] && dcolor="$CYAN"
    fi

    flag=""; (( is_main )) && flag="real data"
    printf '%-26s %-24s %-6s %b%-7s%b %b%-8s%b %b%s%b\n' \
      "$(basename "$wt")" "$br" "$port" \
      "$scolor" "$state" "$NC" \
      "$dcolor" "$delta" "$NC" \
      "$RED" "$flag" "$NC"
  done

hr

# ---------- daemons ----------
printf '%sDAEMONS%s\n' "$BOLD" "$NC"
found=0
for port in 8002 $(seq 8011 8060); do
  health="$(curl -s -m 1 "http://127.0.0.1:${port}/health" 2>/dev/null)" || continue
  [[ -z "$health" ]] && continue
  found=1
  db="$(printf '%s' "$health" | sed -n 's/.*"db_file":"\([^"]*\)".*/\1/p')"
  flag=""
  [[ "$db" == "$REAL_DB" ]] && flag=" ${RED}<- REAL DATA${NC}"
  printf '  %b:%-5s%b  %s%b\n' "$GREEN" "$port" "$NC" "$db" "$flag"
done
(( found )) || printf '  %snone running%s\n' "$DIM" "$NC"

hr

# ---------- open reviews ----------
printf '%sTUICR REVIEWS%s  %s(this repo)%s\n' "$BOLD" "$NC" "$DIM" "$NC"
if command -v tuicr >/dev/null 2>&1; then
  tuicr review list --repo "$MAIN_REPO" 2>/dev/null \
  | python3 -c '
import json, sys
try:
    rows = json.load(sys.stdin)
except Exception:
    print("  (could not read tuicr output)"); raise SystemExit
if not rows:
    print("  none"); raise SystemExit
for r in rows[:6]:
    slug = r.get("slug", "?")
    if slug.count("/") > 1:            # trim the owner/repo prefix, keep the useful tail
        slug = slug.split("/", 1)[1]
    n, done = r.get("comment_count", 0), r.get("reviewed_count", 0)
    mark = " <- OPEN COMMENTS" if n and not r.get("active") else ""
    star = "*" if r.get("active") else " "
    print(f"  {star} {slug[:52]:52s} {n:>2} comment(s), {done:>2} reviewed{mark}")
' 2>/dev/null || printf '  %s(tuicr query failed)%s\n' "$DIM" "$NC"
else
  printf '  %stuicr not installed%s\n' "$DIM" "$NC"
fi

hr
printf '%stmux windows:%s ' "$BOLD" "$NC"
tmux list-windows -F '#{window_index}:#{window_name}' 2>/dev/null | paste -sd'  ' - || printf 'n/a'
echo
