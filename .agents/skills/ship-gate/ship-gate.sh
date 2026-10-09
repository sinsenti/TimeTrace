#!/usr/bin/env bash
# TimeTrace pre-merge gate: tests, lint, JS syntax, migrations on a DB COPY, daemon boot.
# Usage: .agents/skills/ship-gate/ship-gate.sh [base-branch]   (default: dev)
#
# Never touches ~/.timetrace/timetrace.db and never binds port 8002.

set -uo pipefail

BASE="${1:-dev}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
REAL_DB="${TIMETRACE_DB_FILE:-$HOME/.timetrace/timetrace.db}"
SCRATCH_DIR="$(mktemp -d -t tt-ship-gate-XXXXXX)"
SCRATCH_DB="$SCRATCH_DIR/timetrace.db"
GATE_PORT="${TT_GATE_PORT:-8099}"
DAEMON_LOG="$SCRATCH_DIR/daemon.log"
DAEMON_PID=""
FAILED=0

cd "$REPO_ROOT" || exit 1

cleanup() {
    [ -n "$DAEMON_PID" ] && kill "$DAEMON_PID" 2>/dev/null
    wait "$DAEMON_PID" 2>/dev/null
    rm -rf "$SCRATCH_DIR"
}
trap cleanup EXIT

fail() { echo "  FAIL  $*"; FAILED=1; }
pass() { echo "  PASS  $*"; }

echo "SHIP GATE - $(git rev-parse --abbrev-ref HEAD) vs $BASE"
echo

# ---------------------------------------------------------- 1. pytest
echo "[1] regression suite"
if uv run python -P -m pytest -q > "$SCRATCH_DIR/pytest.log" 2>&1; then
    tail -2 "$SCRATCH_DIR/pytest.log" | sed 's/^/          /'
    pass "full pytest suite passed"
else
    fail "pytest suite failed:"
    tail -30 "$SCRATCH_DIR/pytest.log" | sed 's/^/          /'
fi
echo

# ---------------------------------------------------------------- 2. ruff
# Never switches branches (worktrees may be in play). Base versions of the
# changed files are materialized into a temp tree with `git show` instead.
echo "[2] ruff"
uv run ruff check . --output-format=concise 2>/dev/null | sort > "$SCRATCH_DIR/tree.txt"
TREE_N=$(wc -l < "$SCRATCH_DIR/tree.txt")

PY_FILES=$(git diff --name-only "$BASE"...HEAD -- '*.py' 2>/dev/null)
if [ -z "$PY_FILES" ]; then
    pass "no .py files changed ($TREE_N pre-existing violations tree-wide)"
else
    BASE_TREE="$SCRATCH_DIR/base"
    for f in $PY_FILES; do
        mkdir -p "$BASE_TREE/$(dirname "$f")"
        git show "$BASE:$f" > "$BASE_TREE/$f" 2>/dev/null || true
    done
    cp pyproject.toml "$BASE_TREE/" 2>/dev/null

    # Keep only actual per-violation lines (drop ruff's "Found N errors."/"[*] N
    # fixable" footer, which otherwise gets compared as if it were a violation and
    # differs -- spuriously -- any time the total count differs between the two
    # trees, i.e. on every real branch). Strip only the line:col, keeping the file
    # path, so the comparison stays scoped per-file -- stripping the path too
    # collapses every file's violations into one global bag, where a fix in file A
    # can silently cancel out a genuinely new violation in file B. Normalize E501's
    # embedded overflow count so a pre-existing long line getting a few characters
    # longer isn't indistinguishable from a brand new violation elsewhere in the
    # same file -- only (file + rule) is what "new" should mean here.
    ruff_codes() {
        grep -E ':[0-9]+:[0-9]+: ' \
        | sed -E 's/^([^:]+):[0-9]+:[0-9]+: /\1: /' \
        | sed -E 's/\([0-9]+ > [0-9]+\)/(N > N)/' \
        | sort
    }
    (cd "$BASE_TREE" && uv run --project "$REPO_ROOT" ruff check . --output-format=concise 2>/dev/null) \
        | ruff_codes > "$SCRATCH_DIR/ruff_before.txt"
    # shellcheck disable=SC2086
    uv run ruff check $PY_FILES --output-format=concise 2>/dev/null \
        | ruff_codes > "$SCRATCH_DIR/ruff_after.txt"

    NEW=$(comm -13 "$SCRATCH_DIR/ruff_before.txt" "$SCRATCH_DIR/ruff_after.txt")
    if [ -n "$NEW" ]; then
        fail "new violations in changed files:"
        echo "$NEW" | sed 's/^/          /'
        echo "          (run scoped Ruff autofix on the changed file(s))"
    else
        pass "0 new violations in $(echo "$PY_FILES" | wc -w) changed file(s); $TREE_N pre-existing tree-wide"
    fi
fi
echo

# ------------------------------------------------------------ 3. js syntax
echo "[3] js syntax"
JS_FILES=$(git diff --name-only "$BASE"...HEAD -- '*.js' 2>/dev/null)
if [ -z "$JS_FILES" ]; then
    pass "no .js files changed"
elif ! command -v node >/dev/null 2>&1; then
    echo "  SKIP  node not available"
else
    JS_OK=1
    for f in $JS_FILES; do
        [ -f "$f" ] || continue
        node --check "$f" 2>&1 | sed 's/^/          /' && continue
        fail "$f does not parse"; JS_OK=0
    done
    [ "$JS_OK" = "1" ] && pass "$(echo "$JS_FILES" | wc -w) file(s) parse"
fi
echo

# ------------------------------------------------------------ 4. migrations
echo "[4] migrations (on a copy - the real DB is never touched)"
if [ ! -f "$REAL_DB" ]; then
    echo "  SKIP  no database at $REAL_DB; testing against an empty one"
else
    cp "$REAL_DB" "$SCRATCH_DB"
fi

if ! TIMETRACE_DB_FILE="$SCRATCH_DB" uv run timetrace db migrate > "$SCRATCH_DIR/migrate.log" 2>&1; then
    fail "alembic upgrade head failed:"
    tail -20 "$SCRATCH_DIR/migrate.log" | sed 's/^/          /'
else
    pass "upgrade head applied"
    if command -v sqlite3 >/dev/null 2>&1; then
        FK=$(sqlite3 "$SCRATCH_DB" "PRAGMA foreign_key_check;" 2>/dev/null)
        if [ -n "$FK" ]; then
            fail "foreign_key_check not empty:"; echo "$FK" | head -10 | sed 's/^/          /'
        else
            pass "foreign_key_check empty"
        fi
        if [ -f "$REAL_DB" ]; then
            for t in task session habit habitlog ratingentry; do
                A=$(sqlite3 "$REAL_DB"    "SELECT COUNT(*) FROM $t;" 2>/dev/null)
                B=$(sqlite3 "$SCRATCH_DB" "SELECT COUNT(*) FROM $t;" 2>/dev/null)
                [ -z "$A" ] && continue
                if [ "$A" != "$B" ]; then fail "row count changed: $t $A -> $B"; else pass "$t rows $A -> $B"; fi
            done
        fi
    else
        echo "  SKIP  sqlite3 not available; foreign_key_check and row counts unverified"
    fi
fi
echo

# ----------------------------------------------------------- 5. daemon boot
echo "[5] daemon boot + /health (port $GATE_PORT, scratch DB)"
TIMETRACE_DB_FILE="$SCRATCH_DB" TIMETRACE_PORT="$GATE_PORT" \
    uv run timetrace daemon > "$DAEMON_LOG" 2>&1 &
DAEMON_PID=$!

HEALTH=""
for _ in $(seq 1 20); do
    sleep 0.5
    HEALTH=$(curl -fs "localhost:$GATE_PORT/health" 2>/dev/null) && break
done

if [ -n "$HEALTH" ]; then
    pass "/health -> $HEALTH"
else
    fail "daemon did not serve /health; last lines of its log:"
    tail -20 "$DAEMON_LOG" | sed 's/^/          /'
fi
echo

# ---------------------------------------------------------------- verdict
if [ "$FAILED" -eq 0 ]; then
    echo "VERDICT: READY FOR REVIEW  (hand to the merge-review skill; do not merge on this alone)"
    exit 0
fi
echo "VERDICT: BLOCKED"
exit 1
