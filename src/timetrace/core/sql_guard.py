"""The sandbox for read-only SQL widgets (statistics dashboards, slice 3).

Pure module: `sqlite3` (for its action constants only), `re`, and this project's
`ValidationError`. No FastAPI, no SQLAlchemy, no DB handle.

There are three independent layers protecting the SQL escape hatch, and it matters which one
is which:

  1. **The OS/VFS handle** -- `db/readonly.py` opens the database file with `mode=ro` via a
     SQLite URI, on its own engine. Nothing routed through this module ever touches the ORM
     session's read/write connection.
  2. **`PRAGMA query_only = ON`** -- set per connection in `db/readonly.py`, so even a
     writable handle would refuse to mutate.
  3. **The authorizer in this module** -- `install_authorizer()` registers a default-DENY
     `sqlite3.Connection.set_authorizer` callback. This is the real security boundary: it is
     enforced by SQLite while *preparing* the statement, so it cannot be talked around by
     string tricks, nesting, CTEs, views, triggers, or subqueries.

`validate_sql()` is explicitly NOT part of that boundary -- see its docstring.
"""

import re
import sqlite3

from timetrace.core.exceptions import ValidationError

# --------------------------------------------------------------------------------------------
# Allowlists
# --------------------------------------------------------------------------------------------

# Tables a SQL widget may read. Additions here are a security decision, not a convenience one.
#
# Deliberately absent, and each for a reason:
#   * every `ai*` table -- `aiproviderconfig.api_key_encrypted` is a Fernet-encrypted provider
#     secret, and `aichatmessage`/`aiconversation` are free-text conversation history.
#   * `dashboard` / `dashboardwidget` -- a widget that reads the widget table is a self-
#     referential curiosity with no analytic value, and it would let stored SQL text be
#     exfiltrated by a widget that only claims to count rows.
#   * `externalsyncstate` -- unused groundwork that may hold provider tokens later.
#   * `alembic_version` -- schema-version metadata, not user data.
#   * `sqlite_master` / `sqlite_temp_master` / `sqlite_sequence` -- schema introspection. The
#     SQL editor's schema reference is served from `SQLModel.metadata` instead
#     (`SqlQueryService.schema_snapshot`), so denying these costs the user nothing.
ALLOWED_TABLES: frozenset[str] = frozenset(
    {
        "task",
        "taskstatus",
        "session",
        "recurrenceexception",
        "taskreview",
        "dayreview",
        "ratingdefinition",
        "ratingentry",
        "habit",
        "habitlog",
        "habitgoalhistory",
    }
)

# SQL functions a widget may call. Default-deny by construction: anything not listed here is
# refused, which covers `load_extension`, `readfile`/`writefile`, `edit`, and every SQLite
# function added in a future release without anyone having to remember to blocklist it.
ALLOWED_FUNCTIONS: frozenset[str] = frozenset(
    {
        "count",
        "avg",
        "sum",
        "total",
        "min",
        "max",
        "abs",
        "round",
        "coalesce",
        "ifnull",
        "nullif",
        "cast",
        "length",
        "substr",
        "instr",
        "trim",
        "ltrim",
        "rtrim",
        "upper",
        "lower",
        "replace",
        "printf",
        "date",
        "time",
        "datetime",
        "strftime",
        "julianday",
        "unixepoch",
        "group_concat",
        "row_number",
        "rank",
        "dense_rank",
        "lag",
        "lead",
        "first_value",
        "last_value",
        "over",
        "ntile",
        "iif",
        "like",
        "glob",
        "typeof",
        "json_extract",
    }
)


# --------------------------------------------------------------------------------------------
# The authorizer (the actual security boundary)
# --------------------------------------------------------------------------------------------


def make_authorizer(real_object_names: frozenset[str]):
    """Build a default-DENY `sqlite3` authorizer for read-only analytics SQL.

    `real_object_names` is the set of names that actually exist in the database file
    (tables, views, indexes -- lowercased). It is what lets a read of a *query-local* name
    be told apart from a read of a *stored* one; see the SQLITE_READ branch below.

    The returned callback returns `SQLITE_DENY` (never `SQLITE_IGNORE`) for anything not
    explicitly permitted. `SQLITE_IGNORE` would silently substitute NULL for the denied read
    and let the statement succeed, handing the user a plausible-looking wrong answer;
    `SQLITE_DENY` aborts statement preparation with an error, which is the honest outcome.

    Permitted:
      * `SQLITE_SELECT` -- permission to run a SELECT at all; carries no arguments.
      * `SQLITE_READ` -- reading `arg1`.`arg2` (table.column). Allowed iff `arg1` is an
        allowlisted table, OR `arg1` does not name anything stored in the database file.
      * `SQLITE_FUNCTION` -- calling function `arg2` (arg1 is None for this action), allowed
        only from `ALLOWED_FUNCTIONS`.
      * `SQLITE_RECURSIVE` -- a recursive CTE.

    Everything else falls through to DENY: ATTACH/DETACH, PRAGMA, INSERT/UPDATE/DELETE,
    CREATE/DROP/ALTER of anything, transactions, REINDEX, ANALYZE, COPY, and any action code
    a future SQLite version introduces.

    **Why SQLITE_READ needs the "not a real object" escape hatch.** SQLite authorizes reads
    of a recursive CTE's own columns under the *CTE's* name (`SQLITE_READ, 'c', ''`), not
    under any real table, so a strict `arg1 in ALLOWED_TABLES` check made every recursive
    CTE fail -- while `WITH`/`RECURSIVE` are explicitly supported here. Reads that come from
    a real table are always reported against that real table's name (verified against
    SQLite 3.45: a CTE or subquery over `session` still raises
    `SQLITE_READ, 'session', 'tags'`), so permitting a name that isn't stored in the file
    only ever permits re-reading rows some already-authorized read produced.

    Checking against *stored object names* rather than parsing the CTE names out of the SQL
    text is what closes the shadowing hole: `WITH aiproviderconfig AS (SELECT
    api_key_encrypted FROM aiproviderconfig) SELECT * FROM aiproviderconfig` uses the real
    table inside its own (non-recursive) CTE body, so a text-derived "these names are CTEs,
    let them through" list would have handed over exactly the encrypted-secrets table this
    allowlist exists to protect. Here that name is a real object and not allowlisted, so it
    is denied regardless of how it is wrapped.
    """

    def authorizer(
        action: int,
        arg1: str | None,
        arg2: str | None,
        db_name: str | None,
        trigger_or_view: str | None,
    ) -> int:
        if action == sqlite3.SQLITE_SELECT:
            return sqlite3.SQLITE_OK

        if action == sqlite3.SQLITE_READ:
            name = (arg1 or "").lower()
            if name in ALLOWED_TABLES:
                return sqlite3.SQLITE_OK
            if name in real_object_names:
                return sqlite3.SQLITE_DENY
            # Not stored in this database: a CTE or derived-table alias.
            return sqlite3.SQLITE_OK

        if action == sqlite3.SQLITE_FUNCTION:
            func = (arg2 or "").lower()
            return sqlite3.SQLITE_OK if func in ALLOWED_FUNCTIONS else sqlite3.SQLITE_DENY

        if action == sqlite3.SQLITE_RECURSIVE:
            return sqlite3.SQLITE_OK

        return sqlite3.SQLITE_DENY

    return authorizer


def install_authorizer(dbapi_connection, real_object_names: frozenset[str]) -> None:
    """Attach a `make_authorizer` callback to a raw pysqlite connection."""
    dbapi_connection.set_authorizer(make_authorizer(real_object_names))


# --------------------------------------------------------------------------------------------
# Usability pre-check (NOT the security boundary)
# --------------------------------------------------------------------------------------------

_FORBIDDEN_KEYWORDS = (
    "INSERT",
    "UPDATE",
    "DELETE",
    "REPLACE",
    "DROP",
    "ALTER",
    "CREATE",
    "ATTACH",
    "DETACH",
    "PRAGMA",
    "VACUUM",
    "REINDEX",
    "BEGIN",
    "COMMIT",
    "ROLLBACK",
    "ANALYZE",
)

# Strips, in one pass: -- line comments, /* */ block comments, 'single-quoted' strings,
# "double-quoted" identifiers, [bracketed] identifiers and `backticked` identifiers. Each
# alternative is replaced by a single space so token boundaries survive.
_LITERALS_AND_COMMENTS = re.compile(
    r"--[^\n]*"
    r"|/\*.*?\*/"
    r"|'(?:[^']|'')*'"
    r"|\"(?:[^\"]|\"\")*\""
    r"|\[[^\]]*\]"
    r"|`(?:[^`]|``)*`",
    re.DOTALL,
)

_PLACEHOLDER = re.compile(r"\?|[:@$][A-Za-z_][A-Za-z0-9_]*")


def strip_literals_and_comments(sql: str) -> str:
    """Replace every string literal, quoted identifier and comment with a single space."""
    return _LITERALS_AND_COMMENTS.sub(" ", sql)


def validate_sql(sql: str, max_len: int) -> None:
    """Reject obviously-wrong SQL early, with a message a human can act on.

    **This is a usability pre-check, not the security boundary.** Do not add rules here
    believing they make the feature safe, and do not remove the authorizer believing this
    function covers it. It is a regex pass over text; the authorizer in this module is
    enforced by SQLite itself during statement preparation and is what actually contains a
    malicious query. Everything below exists so a user typing `DELETE ...` gets "only
    read-only SELECT queries are allowed" instead of an opaque driver error.

    Raises `ValidationError` on: an empty or over-long query; a query not starting with
    SELECT/WITH; more than one statement; a write/DDL/PRAGMA keyword outside a literal; or a
    bind placeholder (parameters are unsupported -- pysqlite would otherwise fail with
    "Incorrect number of bindings supplied", which explains nothing).
    """
    if not sql or not sql.strip():
        raise ValidationError("SQL query is empty.")

    if len(sql) > max_len:
        raise ValidationError(f"SQL query is too long ({len(sql)} characters, limit {max_len}).")

    bare = strip_literals_and_comments(sql).strip()
    if not bare:
        raise ValidationError("SQL query contains no statement.")

    first_token = re.split(r"[^A-Za-z_]", bare.lstrip("( \t\r\n"), maxsplit=1)[0].upper()
    if first_token not in ("SELECT", "WITH"):
        raise ValidationError("Only read-only queries are allowed: the query must start with SELECT or WITH.")

    # Trailing semicolons are fine; a semicolon with anything after it is a second statement.
    if ";" in bare.rstrip().rstrip(";"):
        raise ValidationError("Only a single statement is allowed (remove the ';' and everything after it).")

    for keyword in _FORBIDDEN_KEYWORDS:
        # `replace` is both a forbidden statement keyword (REPLACE INTO ...) and an allowed
        # scalar function (`replace(col, 'a', 'b')`). Only the statement form -- the one not
        # immediately followed by an open paren -- is rejected here. No other keyword in the
        # list collides with an allowlisted function name.
        suffix = r"(?![A-Za-z0-9_])(?!\s*\()" if keyword == "REPLACE" else r"(?![A-Za-z0-9_])"
        if re.search(rf"(?<![A-Za-z0-9_]){keyword}{suffix}", bare, re.IGNORECASE):
            raise ValidationError(f"'{keyword}' is not allowed: SQL widgets are read-only, SELECT queries only.")

    if _PLACEHOLDER.search(bare):
        raise ValidationError(
            "Query parameters are not supported. Write literal values directly into the SQL "
            "instead of using '?', ':name', '@name' or '$name' placeholders."
        )


def wrap_with_limit(sql: str, limit: int) -> str:
    """Wrap a validated query in an outer `LIMIT` the user's SQL cannot escape.

    `limit` MUST already be a validated `int` (the caller clamps it against
    `settings.sql_max_rows`) -- it is interpolated into SQL text, so a string here would be
    an injection point.

    The leading newline before the user's SQL and before the closing paren are both
    load-bearing: a trailing `-- comment` on the last line of the user's query would
    otherwise comment out the `) LIMIT n` and produce a syntax error.

    `limit + 1` is fetched so the caller can tell "exactly n rows" from "n rows and there
    were more", and report `truncated`.
    """
    return f"SELECT * FROM (\n{sql}\n) LIMIT {int(limit) + 1}"
