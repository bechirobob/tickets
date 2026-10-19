"""Offline, fixed-scope PURO EXCESO inserts for an operator-owned SQLite connection.

This module never opens a database, reads credentials, sends messages, or connects
to a service. The caller must verify its live destination, take a recoverable
snapshot, and independently establish any organizer-account mapping. The caller
supplies an idle connection; this module owns one BEGIN IMMEDIATE transaction.
"""

from datetime import datetime, timezone
import hashlib
import json
import sqlite3
import unicodedata

SLUG = "puro-exceso-20261024"
EVENT_ID = "event:" + SLUG
SUBMISSION_ID = "listing:" + SLUG
AUDIT_ID = "curation:" + SLUG + ":publish"
HOST_ID = "host:kofi-bills"
START = "2026-10-24T21:00:00.000Z"
END = "2026-10-25T04:00:00.000Z"
DESCRIPTION = (
    "PURO EXCESO at CINCO, Osu Oxford Street, Accra. Saturday 24 October 2026 "
    "from 9 PM, hosted by Kofi Bills, with DJs Kofi Kay, OJ and Big Syder. "
    "Booking and reservations: +233 55 505 5753."
)
LINEUP = "Hosted by Kofi Bills. DJs: Kofi Kay, OJ and Big Syder."
AGE = "Confirm entry requirements with the organiser"
KEYS = {
    "party_submissions": ("id",),
    "curated_event_records": ("id",),
    "event_registration_settings": ("event_slug",),
    "event_hosts": ("event_slug", "host_id"),
    "staff_event_assignments": ("account_id", "event_slug"),
    "curation_audit_events": ("id",),
}


class GuardError(RuntimeError):
    """The database did not satisfy the fixed operation's prerequisites."""


def _quote(name):
    return '"' + name.replace('"', '""') + '"'


def _rows(db, sql, values=()):
    cursor = db.execute(sql, values)
    names = [column[0] for column in cursor.description]
    return [dict(zip(names, row)) for row in cursor]


def schema_fingerprint(db):
    """Match inspect.py's schema fingerprint, without reading row contents."""
    rows = [list(row) for row in db.execute(
        "SELECT type,name,tbl_name,sql FROM sqlite_master "
        "WHERE sql IS NOT NULL ORDER BY type,name"
    )]
    return hashlib.sha256(json.dumps(rows, separators=(",", ":")).encode()).hexdigest()


def _encode(row):
    # Typed, length-delimited JSON avoids text/integer/blob ambiguity. Only
    # hashes leave this helper; no credential or personal row data is returned.
    values = []
    for value in row:
        if value is None:
            values.append(["null"])
        elif isinstance(value, bytes):
            values.append(["blob", value.hex()])
        elif isinstance(value, int):
            values.append(["int", str(value)])
        elif isinstance(value, float):
            values.append(["real", value.hex()])
        else:
            values.append(["text", value])
    return json.dumps(values, ensure_ascii=True, separators=(",", ":")).encode()


def database_evidence(db, exclude=None):
    """Digest every main database table, including SQLite bookkeeping tables.

    Exclusions are exact primary/unique keys for this operation's new rows only.
    Their complete values are checked separately before committing.
    """
    result = {}
    for (table,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        cursor = db.execute("SELECT * FROM " + _quote(table))
        columns = [column[0] for column in cursor.description]
        omitted = (exclude or {}).get(table)
        hashes = []
        for row in cursor:
            if omitted and all(row[columns.index(key)] == omitted[key] for key in KEYS[table]):
                continue
            hashes.append(hashlib.sha256(_encode(row)).digest())
        payload = json.dumps(columns, separators=(",", ":")).encode() + b"\n" + b"".join(sorted(hashes))
        result[table] = {"rows": len(hashes), "sha256": hashlib.sha256(payload).hexdigest()}
    return result


def planned_rows(flyer_bytes, *, now, actor_account_id, organizer_account_id):
    """Return the fixed insert plan; no generic caller-supplied event fields."""
    approval_note = ("owner-managed RSVP approval; no organizer account assigned"
                     if organizer_account_id is None else "host approval required")
    common = dict(title="PURO EXCESO", area="Osu Oxford Street, Accra", starts_at=START,
                  ends_at=END, vibe="Late night", lineup=LINEUP, capacity=200,
                  price_from_minor=0, age_restriction=AGE, venue_map_url=None,
                  curation_note=DESCRIPTION, tagline=None, status="published",
                  scheduled_publish_at=None, published_at=now, created_at=now, updated_at=now)
    rows = {
        "party_submissions": dict(common, id=SUBMISSION_ID, organizer_name="Kofi Bills",
            contact_name="Kofi Bills", contact_email="", contact_phone="+233555055753",
            concept=DESCRIPTION, venue_name="CINCO", social_url=None,
            poster_object_key="submission-posters/" + SUBMISSION_ID,
            poster_content_type="image/jpeg", poster_data=flyer_bytes,
            organizer_access_pending=0, review_note=None, event_slug=SLUG),
        "curated_event_records": dict(common, id=EVENT_ID, submission_id=SUBMISSION_ID,
            organizer_owner_id=organizer_account_id, slug=SLUG, venue="CINCO",
            sales_open_at=None, sales_close_at=None, event_state="on_sale", rescheduled_from=None,
            removed_at=None, archived_at=None, is_test_event=0, schedule_label=None,
            # Existing 0035 publication triggers require this for every public
            # non-test event. This follows that invariant, not a new assessment
            # inferred from the host's separate verification badge.
            schedule_status="confirmed", is_verified=1, dress_code=None, colour_scheme=None,
            awareness_note=None, guest_perk=None, image_url="/api/media/" + SUBMISSION_ID),
        "event_registration_settings": dict(event_slug=SLUG, mode="rsvp", capacity=200,
            max_party_size=1, approval_required=1, room_access=1, accepting=1,
            closes_at=None, notify_host=1, allow_undated_rsvp=0, updated_at=now),
        "event_hosts": dict(event_slug=SLUG, host_id=HOST_ID, role="Host", is_primary=1, created_at=now),
        "curation_audit_events": dict(id=AUDIT_ID, submission_id=SUBMISSION_ID, action="publish",
            from_status=None, to_status="published", actor=actor_account_id, created_at=now,
            note="Owner-approved PURO EXCESO listing; RSVP capacity 200; " + approval_note + "; ends 25 October 2026 at 04:00 Accra time as confirmed by owner."),
    }
    if organizer_account_id is not None:
        rows["staff_event_assignments"] = dict(account_id=organizer_account_id, event_slug=SLUG,
            assigned_by=actor_account_id, assigned_at=now)
    return rows


def _lookup(db, table, record):
    keys = KEYS[table]
    return _rows(db, "SELECT * FROM " + _quote(table) + " WHERE " +
                 " AND ".join(_quote(key) + "=?" for key in keys), [record[key] for key in keys])


def _assert_expected(db, plan):
    for table, record in plan.items():
        if _lookup(db, table, record) != [record]:
            raise GuardError("Fixed event row mismatch in " + table)
    if "staff_event_assignments" not in plan and db.execute(
            "SELECT 1 FROM staff_event_assignments WHERE event_slug=? LIMIT 1", (SLUG,)).fetchone():
        raise GuardError("Owner-managed event must not have an organizer assignment")


def _assert_identity(db, actor_account_id, organizer_account_id):
    host = _rows(db, "SELECT id,slug,name FROM hosts WHERE id=? OR slug='kofi-bills'", (HOST_ID,))
    if host != [dict(id=HOST_ID, slug="kofi-bills", name="Kofi Bills")]:
        raise GuardError("Existing Kofi Bills host identity is missing or ambiguous")
    actor = db.execute("SELECT role,status FROM staff_accounts WHERE id=?", (actor_account_id,)).fetchone()
    if actor is None or tuple(actor) != ("owner", "active"):
        raise GuardError("An existing active owner actor is required")
    if organizer_account_id is not None:
        organizer = db.execute("SELECT role,status FROM staff_accounts WHERE id=?", (organizer_account_id,)).fetchone()
        if organizer is None or tuple(organizer) != ("organizer", "active"):
            raise GuardError("An existing active organizer is required; verify its Kofi Bills mapping before calling")


def _assert_organizer_source(db, organizer_account_id, source_slug):
    # Validate the inspected mapping again under the same write lock as the new
    # listing. Names never establish account identity, and a matching email
    # alone never grants event access. Count all matching active organizers so
    # even malformed duplicate normalized emails fail closed.
    candidates = db.execute("""
        SELECT a.id,
            CASE WHEN e.organizer_owner_id=a.id OR EXISTS (
                SELECT 1 FROM staff_event_assignments assignment
                WHERE assignment.event_slug=e.slug AND assignment.account_id=a.id
            ) THEN 1 ELSE 0 END AS has_source_access
        FROM curated_event_records e
        JOIN party_submissions s ON s.id=e.submission_id
        JOIN event_hosts h ON h.event_slug=e.slug AND h.host_id=?
        JOIN staff_accounts a ON lower(trim(a.normalized_email))=lower(trim(s.contact_email))
        WHERE e.slug=? AND e.removed_at IS NULL AND e.archived_at IS NULL
            AND trim(s.contact_email)<>'' AND a.role='organizer' AND a.status='active'
        ORDER BY a.id
    """, (HOST_ID, source_slug)).fetchall()
    if len(candidates) != 1 or tuple(candidates[0]) != (organizer_account_id, 1):
        raise GuardError("Inspected Kofi Bills organizer source mapping is no longer unique and authorized")


def _assert_no_collision(db, allow_existing):
    normalize = lambda value: "".join(c for c in unicodedata.normalize("NFKD", value).casefold() if c.isalnum())
    for table, slug_column, record_id in (("curated_event_records", "slug", EVENT_ID),
                                         ("party_submissions", "event_slug", SUBMISSION_ID)):
        for row in _rows(db, f"SELECT id,title,{slug_column} AS slug FROM {table}"):
            if row["id"] == record_id or row["slug"] == SLUG or normalize(row["title"]) == "puroexceso":
                if not (allow_existing and row["id"] == record_id and row["slug"] == SLUG):
                    raise GuardError("Existing PURO EXCESO identity or title collision in " + table)
    if not allow_existing:
        for (table,) in db.execute("SELECT name FROM sqlite_master WHERE type='table'"):
            columns = {row[1] for row in db.execute("PRAGMA table_info(" + _quote(table) + ")")}
            for column, value in (("event_slug", SLUG), ("submission_id", SUBMISSION_ID)):
                if column in columns and db.execute("SELECT 1 FROM " + _quote(table) + " WHERE " +
                                                     _quote(column) + "=? LIMIT 1", (value,)).fetchone():
                    raise GuardError("Pre-existing event-linked data in " + table)


def insert_event(db, flyer_bytes, *, actor_account_id, organizer_account_id,
                 now=None, expected_schema_fingerprint=None, expected_organizer_source_slug=None):
    """Atomically insert the approved listing, or verify an exact prior insert.

    A rerun never updates data. Partial inserts, changed settings, alternate
    artwork, schema drift, title collisions, and unexpected trigger effects all
    fail closed. No ticket inventory, consents, users, or notification outbox rows
    are created. A supplied organizer mapping must be independently verified.
    Explicit organizer_account_id=None selects owner-managed approvals using
    existing global owner access only, with no new staff assignment or account.
    The caller must obtain approval for that owner-managed mode before use.
    When supplied, expected_organizer_source_slug rechecks the inspected source
    submission's email, public host link, and existing organizer access under the
    transaction lock. It does not infer a mapping from display names.
    """
    if db.in_transaction:
        raise GuardError("An idle connection is required; caller transaction was left untouched")
    if not isinstance(flyer_bytes, bytes) or not flyer_bytes.startswith(b"\xff\xd8\xff") or not flyer_bytes.endswith(b"\xff\xd9"):
        raise GuardError("The original JPEG flyer bytes are required")
    if len(flyer_bytes) > 1_500_000:
        raise GuardError("Flyer exceeds the existing 1,500,000-byte storage limit")
    now = now or datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    try:
        parsed = datetime.strptime(now, "%Y-%m-%dT%H:%M:%S.%fZ")
        if len(now) != 24 or parsed.strftime("%Y-%m-%dT%H:%M:%S.") + f"{parsed.microsecond // 1000:03d}Z" != now:
            raise ValueError()
    except (ValueError, TypeError):
        raise GuardError("now must be an ISO UTC millisecond timestamp") from None
    db.execute("BEGIN IMMEDIATE")
    try:
        fingerprint = schema_fingerprint(db)
        if expected_schema_fingerprint is not None and fingerprint != expected_schema_fingerprint:
            raise GuardError("Schema fingerprint changed since inspection")
        if tuple(db.execute("PRAGMA quick_check").fetchone()) != ("ok",) or db.execute("PRAGMA foreign_key_check").fetchone():
            raise GuardError("Pre-existing database integrity failure")
        _assert_identity(db, actor_account_id, organizer_account_id)
        if expected_organizer_source_slug is not None:
            if organizer_account_id is None:
                raise GuardError("Organizer source mapping cannot be supplied for owner-managed approvals")
            _assert_organizer_source(db, organizer_account_id, expected_organizer_source_slug)
        existing = db.execute("SELECT created_at FROM curated_event_records WHERE id=?", (EVENT_ID,)).fetchone()
        plan = planned_rows(flyer_bytes, now=existing[0] if existing else now,
                            actor_account_id=actor_account_id, organizer_account_id=organizer_account_id)
        for table, record in plan.items():
            columns = {row[1] for row in db.execute("PRAGMA table_info(" + _quote(table) + ")")}
            if columns != set(record):
                raise GuardError("Unexpected target schema in " + table)
        _assert_no_collision(db, bool(existing))
        before = database_evidence(db)
        if existing:
            _assert_expected(db, plan)
            result = "already_present"
            preserved = database_evidence(db)
        else:
            for table, record in plan.items():
                db.execute("INSERT INTO " + _quote(table) + " (" + ",".join(map(_quote, record)) +
                           ") VALUES (" + ",".join("?" for _ in record) + ")", tuple(record.values()))
            _assert_expected(db, plan)
            result = "inserted"
            preserved = database_evidence(db, exclude=plan)
        if before != preserved or schema_fingerprint(db) != fingerprint:
            raise GuardError("An unexpected change outside the fixed insert was detected")
        if tuple(db.execute("PRAGMA quick_check").fetchone()) != ("ok",) or db.execute("PRAGMA foreign_key_check").fetchone():
            raise GuardError("Post-insert database integrity failure")
        db.commit()
        return dict(status=result, event_slug=SLUG, inserted_rows=len(plan) if result == "inserted" else 0,
                    schema_fingerprint=fingerprint, flyer_sha256=hashlib.sha256(flyer_bytes).hexdigest(),
                    preserved_tables=preserved, organizer_linked=organizer_account_id is not None)
    except BaseException:
        db.rollback()
        raise
