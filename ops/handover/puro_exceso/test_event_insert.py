"""Run: python3 -m unittest discover -s ops/handover/puro_exceso -p 'test_event_insert.py' -v"""

import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import unittest

DIRECTORY = Path(__file__).resolve().parent
REPOSITORY = DIRECTORY.parents[2]
spec = importlib.util.spec_from_file_location("event_insert", DIRECTORY / "event_insert.py")
event = importlib.util.module_from_spec(spec)
spec.loader.exec_module(event)
NOW = "2026-10-19T14:00:00.000Z"
OWNER = "test:existing-owner"
ORGANIZER = "test:existing-kofi-organizer"
SOURCE_SLUG = "sun-chasers-labadi"
# A small inert JPEG-signature fixture. The supplied real flyer is exercised in
# the separate optional test; the API receives bytes, never a file path or URL.
FLYER = b"\xff\xd8\xff\xe0fixed-test-flyer\xff\xd9"


def migrated_database():
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    for migration in sorted((REPOSITORY / "drizzle").glob("*.sql")):
        db.executescript(migration.read_text())
    for identity, role in ((OWNER, "owner"), (ORGANIZER, "organizer")):
        db.execute("""INSERT INTO staff_accounts
            (id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,
             password_changed_at,created_at,created_by,updated_at)
             VALUES (?,?,?,?, 'inert-test-fixture','inert-test-fixture',1,?,?,?,?)""",
            (identity, identity + "@example.invalid", "Test account", role, NOW, NOW, OWNER, NOW))
    db.executescript('''CREATE TABLE "unrelated evidence" (
        id INTEGER PRIMARY KEY AUTOINCREMENT, value, amount, image BLOB);
        INSERT INTO "unrelated evidence" (value,amount,image) VALUES ('preserve',12.5,X'0001FF');
        INSERT INTO "unrelated evidence" (value,amount,image) VALUES (NULL,9223372036854775807,NULL);''')
    db.commit()
    return db


class EventInsertTests(unittest.TestCase):
    def setUp(self):
        self.db = migrated_database()

    def tearDown(self):
        self.db.close()

    def apply(self, flyer=FLYER, **kwargs):
        options = dict(now=NOW, actor_account_id=OWNER, organizer_account_id=ORGANIZER)
        options.update(kwargs)
        return event.insert_event(self.db, flyer, **options)

    def assert_rejected_without_changes(self, callback, exception=event.GuardError):
        before = event.database_evidence(self.db)
        fingerprint = event.schema_fingerprint(self.db)
        with self.assertRaises(exception):
            callback()
        self.assertEqual(event.database_evidence(self.db), before)
        self.assertEqual(event.schema_fingerprint(self.db), fingerprint)
        self.assertFalse(self.db.in_transaction)

    def prepare_organizer_source(self, owner=True):
        # Historical preview seeds have a submission_id but no intake row.
        # Supply that source fixture explicitly; production must have real
        # source evidence and the guard intentionally rejects its absence.
        self.db.execute("""INSERT INTO party_submissions
            (id,organizer_name,contact_name,contact_email,contact_phone,title,concept,
             venue_name,area,starts_at,ends_at,vibe,lineup,capacity,price_from_minor,
             age_restriction,status,event_slug,created_at,updated_at)
            SELECT submission_id,'Test organizer','Test contact',?,'',title,curation_note,
                venue,area,starts_at,ends_at,vibe,lineup,capacity,price_from_minor,
                age_restriction,status,slug,created_at,updated_at
            FROM curated_event_records WHERE slug=?""",
            ("  " + (ORGANIZER + "@example.invalid").upper() + "  ", SOURCE_SLUG))
        if owner:
            self.db.execute("UPDATE curated_event_records SET organizer_owner_id=? WHERE slug=?", (ORGANIZER, SOURCE_SLUG))
        else:
            self.db.execute("INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES (?,?,?,?)",
                            (ORGANIZER, SOURCE_SLUG, OWNER, NOW))
        self.db.commit()

    def test_fixed_insert_and_complete_preservation(self):
        before = event.database_evidence(self.db)
        before_changes = self.db.total_changes
        result = self.apply(expected_schema_fingerprint=event.schema_fingerprint(self.db))
        self.assertEqual(result["status"], "inserted")
        self.assertEqual(result["inserted_rows"], 6)
        self.assertEqual(self.db.total_changes - before_changes, 6)
        self.assertEqual(result["preserved_tables"], before)
        self.assertTrue(result["organizer_linked"])
        self.assertEqual(result["flyer_sha256"], hashlib.sha256(FLYER).hexdigest())
        plan = event.planned_rows(FLYER, now=NOW, actor_account_id=OWNER, organizer_account_id=ORGANIZER)
        event._assert_expected(self.db, plan)
        self.assertEqual(event.database_evidence(self.db, exclude=plan), before)
        settings = self.db.execute("SELECT mode,capacity,approval_required,accepting,room_access,notify_host "
                                   "FROM event_registration_settings WHERE event_slug=?", (event.SLUG,)).fetchone()
        self.assertEqual(settings, ("rsvp", 200, 1, 1, 1, 1))
        dates = self.db.execute("SELECT starts_at,ends_at,schedule_status,organizer_owner_id "
                                "FROM curated_event_records WHERE slug=?", (event.SLUG,)).fetchone()
        self.assertEqual(dates, (event.START, event.END, "confirmed", ORGANIZER))
        self.assertEqual(self.db.execute("SELECT contact_email,poster_data FROM party_submissions WHERE id=?",
                                        (event.SUBMISSION_ID,)).fetchone(), ("", FLYER))
        self.assertEqual(self.db.execute("SELECT count(*) FROM event_ticket_tiers WHERE event_slug=?",
                                        (event.SLUG,)).fetchone()[0], 0)

    def test_rerun_is_read_only_even_with_later_timestamp(self):
        self.apply()
        before = event.database_evidence(self.db)
        changes = self.db.total_changes
        result = self.apply(now="2026-10-20T14:00:00.000Z")
        self.assertEqual(result["status"], "already_present")
        self.assertEqual(result["inserted_rows"], 0)
        self.assertEqual(self.db.total_changes, changes)
        self.assertEqual(event.database_evidence(self.db), before)

    def test_public_verification_uses_existing_schema_invariant(self):
        trigger = self.db.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='curated_events_verify_insert'").fetchone()[0]
        self.assertIn("NEW.status IN ('published', 'scheduled') AND NEW.is_test_event = 0 AND NEW.is_verified = 0", trigger)
        self.assertIn("UPDATE curated_event_records SET is_verified = 1 WHERE id = NEW.id", trigger)
        self.apply()
        self.assertEqual(self.db.execute("SELECT is_verified FROM curated_event_records WHERE id=?", (event.EVENT_ID,)).fetchone()[0], 1)
        self.assertEqual(self.db.execute("SELECT poster_object_key FROM party_submissions WHERE id=?", (event.SUBMISSION_ID,)).fetchone()[0],
                         "submission-posters/" + event.SUBMISSION_ID)

    def test_rerun_changed_settings_fail_closed(self):
        self.apply()
        self.db.execute("UPDATE event_registration_settings SET capacity=201 WHERE event_slug=?", (event.SLUG,))
        self.db.commit()
        self.assert_rejected_without_changes(self.apply)

    def test_rerun_changed_flyer_fail_closed(self):
        self.apply()
        self.assert_rejected_without_changes(lambda: self.apply(FLYER.replace(b"fixed", b"other")))

    def test_rerun_missing_audit_is_not_repaired(self):
        self.apply()
        self.db.execute("DELETE FROM curation_audit_events WHERE id=?", (event.AUDIT_ID,))
        self.db.commit()
        self.assert_rejected_without_changes(self.apply)

    def test_preexisting_submission_is_not_adopted(self):
        row = event.planned_rows(FLYER, now=NOW, actor_account_id=OWNER, organizer_account_id=ORGANIZER)["party_submissions"]
        self.db.execute("INSERT INTO party_submissions (" + ",".join(row) + ") VALUES (" +
                        ",".join("?" for _ in row) + ")", tuple(row.values()))
        self.db.commit()
        self.assert_rejected_without_changes(self.apply)

    def test_title_variant_collision_is_not_duplicated(self):
        self.db.execute("UPDATE curated_event_records SET title=' PÚRO  EXCESO! ' WHERE id=(SELECT id FROM curated_event_records LIMIT 1)")
        self.db.commit()
        self.assert_rejected_without_changes(self.apply)

    def test_orphan_event_registration_settings_are_not_adopted(self):
        self.db.execute("INSERT INTO event_registration_settings(event_slug,updated_at) VALUES (?,?)", (event.SLUG, NOW))
        self.db.commit()
        self.assert_rejected_without_changes(self.apply)

    def test_missing_host_fails(self):
        self.db.execute("DELETE FROM hosts WHERE id=?", (event.HOST_ID,))
        self.db.commit()
        self.assert_rejected_without_changes(self.apply)

    def test_same_display_name_does_not_replace_host_identity(self):
        self.db.execute("UPDATE hosts SET id='host:other-identity' WHERE id=?", (event.HOST_ID,))
        self.db.commit()
        self.assert_rejected_without_changes(self.apply)

    def test_required_organizer_must_be_active(self):
        self.db.execute("UPDATE staff_accounts SET status='disabled' WHERE id=?", (ORGANIZER,))
        self.db.commit()
        self.assert_rejected_without_changes(self.apply)

    def test_organizer_is_never_created_or_guessed(self):
        self.assert_rejected_without_changes(lambda: self.apply(organizer_account_id="unknown"))
        self.assert_rejected_without_changes(lambda: self.apply(organizer_account_id=OWNER))

    def test_owner_mode_inserts_five_rows_preserving_all_accounts_and_assignments(self):
        before = event.database_evidence(self.db)
        changes = self.db.total_changes
        result = self.apply(organizer_account_id=None)
        self.assertEqual(result["status"], "inserted")
        self.assertEqual(result["inserted_rows"], 5)
        self.assertEqual(self.db.total_changes - changes, 5)
        self.assertFalse(result["organizer_linked"])
        self.assertEqual(result["preserved_tables"], before)
        after = event.database_evidence(self.db)
        self.assertEqual(after["staff_accounts"], before["staff_accounts"])
        self.assertEqual(after["staff_event_assignments"], before["staff_event_assignments"])
        plan = event.planned_rows(FLYER, now=NOW, actor_account_id=OWNER, organizer_account_id=None)
        self.assertNotIn("staff_event_assignments", plan)
        self.assertEqual(event.database_evidence(self.db, exclude=plan), before)
        self.assertEqual(self.db.execute("SELECT organizer_owner_id,starts_at,ends_at,schedule_status "
                                         "FROM curated_event_records WHERE slug=?", (event.SLUG,)).fetchone(),
                         (None, event.START, "2026-10-25T04:00:00.000Z", "confirmed"))
        self.assertEqual(self.db.execute("SELECT approval_required,capacity FROM event_registration_settings WHERE event_slug=?",
                                        (event.SLUG,)).fetchone(), (1, 200))
        self.assertEqual(self.db.execute("SELECT count(*) FROM staff_event_assignments WHERE event_slug=?", (event.SLUG,)).fetchone()[0], 0)
        self.assertIn("owner-managed RSVP approval; no organizer account assigned",
                      self.db.execute("SELECT note FROM curation_audit_events WHERE id=?", (event.AUDIT_ID,)).fetchone()[0])

    def test_owner_mode_rerun_is_read_only(self):
        self.apply(organizer_account_id=None)
        before = event.database_evidence(self.db)
        changes = self.db.total_changes
        result = self.apply(organizer_account_id=None, now="2026-10-20T14:00:00.000Z")
        self.assertEqual(result["status"], "already_present")
        self.assertEqual(result["inserted_rows"], 0)
        self.assertFalse(result["organizer_linked"])
        self.assertEqual(self.db.total_changes, changes)
        self.assertEqual(event.database_evidence(self.db), before)

    def test_owner_mode_does_not_need_or_create_an_organizer_account(self):
        self.db.execute("DELETE FROM staff_accounts WHERE id=?", (ORGANIZER,))
        self.db.commit()
        accounts = event.database_evidence(self.db)["staff_accounts"]
        self.assertEqual(self.apply(organizer_account_id=None)["status"], "inserted")
        self.assertEqual(event.database_evidence(self.db)["staff_accounts"], accounts)

    def test_owner_mode_still_requires_existing_active_owner(self):
        self.assert_rejected_without_changes(lambda: self.apply(organizer_account_id=None, actor_account_id=ORGANIZER))
        self.assert_rejected_without_changes(lambda: self.apply(organizer_account_id=None, actor_account_id="unknown"))

    def test_owner_mode_rejects_organizer_source_configuration(self):
        self.prepare_organizer_source()
        self.assert_rejected_without_changes(lambda: self.apply(organizer_account_id=None, expected_organizer_source_slug=SOURCE_SLUG))

    def test_owner_mode_never_adds_an_organizer_on_rerun(self):
        self.apply(organizer_account_id=None)
        self.assert_rejected_without_changes(self.apply)

    def test_organizer_mode_cannot_be_changed_to_owner_mode(self):
        self.apply()
        self.assert_rejected_without_changes(lambda: self.apply(organizer_account_id=None))

    def test_owner_mode_rejects_preexisting_assignment_without_adopting_it(self):
        self.db.execute("INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES (?,?,?,?)",
                        (ORGANIZER, event.SLUG, OWNER, NOW))
        self.db.commit()
        self.assert_rejected_without_changes(lambda: self.apply(organizer_account_id=None))

    def test_owner_mode_rerun_rejects_unexpected_assignment_without_removing_it(self):
        self.apply(organizer_account_id=None)
        self.db.execute("INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES (?,?,?,?)",
                        (ORGANIZER, event.SLUG, OWNER, NOW))
        self.db.commit()
        self.assert_rejected_without_changes(lambda: self.apply(organizer_account_id=None))

    def test_owner_mode_rolls_back_trigger_added_assignment(self):
        self.db.executescript("""CREATE TRIGGER unexpected_organizer_assignment AFTER INSERT ON event_hosts
            BEGIN INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at)
            VALUES ('test:existing-kofi-organizer',NEW.event_slug,'test:existing-owner','2026-10-19T14:00:00.000Z'); END;""")
        self.assert_rejected_without_changes(lambda: self.apply(organizer_account_id=None))

    def test_actor_must_be_existing_active_owner(self):
        self.assert_rejected_without_changes(lambda: self.apply(actor_account_id=ORGANIZER))
        self.assert_rejected_without_changes(lambda: self.apply(actor_account_id="unknown"))

    def test_organizer_source_owner_mapping_accepts_normalized_email(self):
        self.prepare_organizer_source()
        before = event.database_evidence(self.db)
        statements = []
        self.db.set_trace_callback(statements.append)
        result = self.apply(expected_organizer_source_slug=SOURCE_SLUG)
        self.db.set_trace_callback(None)
        self.assertEqual(result["status"], "inserted")
        self.assertEqual(result["preserved_tables"], before)
        guard_index = next(i for i, sql in enumerate(statements) if "AS has_source_access" in sql)
        begin_index = statements.index("BEGIN IMMEDIATE")
        insert_index = next(i for i, sql in enumerate(statements) if sql.startswith('INSERT INTO "party_submissions"'))
        self.assertLess(begin_index, guard_index)
        self.assertLess(guard_index, insert_index)
        self.assertEqual(self.apply(expected_organizer_source_slug=SOURCE_SLUG)["status"], "already_present")

    def test_organizer_source_existing_assignment_also_authorizes_mapping(self):
        self.prepare_organizer_source(owner=False)
        self.assertIsNone(self.db.execute("SELECT organizer_owner_id FROM curated_event_records WHERE slug=?", (SOURCE_SLUG,)).fetchone()[0])
        self.assertEqual(self.apply(expected_organizer_source_slug=SOURCE_SLUG)["status"], "inserted")

    def test_organizer_source_missing_exact_slug_rejected(self):
        self.prepare_organizer_source()
        for source in ("", "missing-source", "noir-room-labone", SOURCE_SLUG + " "):
            with self.subTest(source=source):
                self.assert_rejected_without_changes(lambda: self.apply(expected_organizer_source_slug=source))

    def test_organizer_source_matching_email_without_existing_access_rejected(self):
        self.prepare_organizer_source()
        self.db.execute("UPDATE curated_event_records SET organizer_owner_id=NULL WHERE slug=?", (SOURCE_SLUG,))
        self.db.execute("INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES (?,?,?,?)",
                        (ORGANIZER, "noir-room-labone", OWNER, NOW))
        self.db.commit()
        self.assert_rejected_without_changes(lambda: self.apply(expected_organizer_source_slug=SOURCE_SLUG))

    def test_organizer_source_must_link_exact_kofi_host(self):
        self.prepare_organizer_source()
        self.db.execute("UPDATE event_hosts SET host_id='host:becore-preview-desk' WHERE event_slug=?", (SOURCE_SLUG,))
        self.db.commit()
        self.assert_rejected_without_changes(lambda: self.apply(expected_organizer_source_slug=SOURCE_SLUG))

    def test_organizer_source_removed_rejected(self):
        self.prepare_organizer_source()
        self.db.execute("UPDATE curated_event_records SET removed_at=? WHERE slug=?", (NOW, SOURCE_SLUG))
        self.db.commit()
        self.assert_rejected_without_changes(lambda: self.apply(expected_organizer_source_slug=SOURCE_SLUG))

    def test_organizer_source_archived_rejected(self):
        self.prepare_organizer_source()
        self.db.execute("UPDATE curated_event_records SET archived_at=? WHERE slug=?", (NOW, SOURCE_SLUG))
        self.db.commit()
        self.assert_rejected_without_changes(lambda: self.apply(expected_organizer_source_slug=SOURCE_SLUG))

    def test_organizer_source_email_mismatch_or_blank_rejected(self):
        self.prepare_organizer_source()
        for email in ("another@example.invalid", "", "   "):
            with self.subTest(email=email):
                self.db.execute("UPDATE party_submissions SET contact_email=? WHERE id=(SELECT submission_id FROM curated_event_records WHERE slug=?)",
                                (email, SOURCE_SLUG))
                self.db.commit()
                self.assert_rejected_without_changes(lambda: self.apply(expected_organizer_source_slug=SOURCE_SLUG))

    def test_organizer_source_duplicate_normalized_account_rejected(self):
        self.prepare_organizer_source()
        columns = [row[1] for row in self.db.execute("PRAGMA table_info(staff_accounts)")]
        expressions = ["?" if name in ("id", "normalized_email") else name for name in columns]
        self.db.execute("INSERT INTO staff_accounts (" + ",".join(columns) + ") SELECT " + ",".join(expressions) +
                        " FROM staff_accounts WHERE id=?", ("test:ambiguous-organizer", (ORGANIZER + "@example.invalid").upper(), ORGANIZER))
        self.db.commit()
        # The second email-equivalent account has no source access. Ambiguous
        # identity still rejects rather than silently selecting the first one.
        self.assert_rejected_without_changes(lambda: self.apply(expected_organizer_source_slug=SOURCE_SLUG))

    def test_organizer_source_is_revalidated_on_rerun(self):
        self.prepare_organizer_source()
        self.apply(expected_organizer_source_slug=SOURCE_SLUG)
        self.db.execute("UPDATE curated_event_records SET organizer_owner_id=NULL WHERE slug=?", (SOURCE_SLUG,))
        self.db.commit()
        self.assert_rejected_without_changes(lambda: self.apply(expected_organizer_source_slug=SOURCE_SLUG))

    def test_schema_fingerprint_matches_inspector(self):
        rows = [list(row) for row in self.db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name")]
        expected = hashlib.sha256(json.dumps(rows, separators=(",", ":")).encode()).hexdigest()
        self.assertEqual(event.schema_fingerprint(self.db), expected)
        self.assert_rejected_without_changes(lambda: self.apply(expected_schema_fingerprint="0" * 64))

    def test_target_schema_drift_rejected(self):
        self.db.execute("ALTER TABLE party_submissions ADD COLUMN future_field TEXT")
        self.db.commit()
        self.assert_rejected_without_changes(self.apply)

    def test_unexpected_trigger_update_to_existing_data_rolls_back(self):
        self.db.executescript("""CREATE TRIGGER unexpected_existing_change AFTER INSERT ON event_hosts
            BEGIN UPDATE hosts SET name='Unexpected modification' WHERE id='host:kofi-bills'; END;""")
        self.assert_rejected_without_changes(self.apply)

    def test_unexpected_trigger_new_row_rolls_back_including_sequence(self):
        self.db.executescript('''CREATE TRIGGER unexpected_extra_insert AFTER INSERT ON event_hosts
            BEGIN INSERT INTO "unrelated evidence" (value) VALUES ('trigger side effect'); END;''')
        self.assert_rejected_without_changes(self.apply)

    def test_unexpected_trigger_target_change_rolls_back(self):
        self.db.executescript("""CREATE TRIGGER unexpected_settings_change AFTER INSERT ON event_registration_settings
            BEGIN UPDATE event_registration_settings SET approval_required=0 WHERE event_slug=NEW.event_slug; END;""")
        self.assert_rejected_without_changes(self.apply)

    def test_late_sql_failure_rolls_back_all_six_tables(self):
        self.db.executescript("""CREATE TRIGGER reject_assignment BEFORE INSERT ON staff_event_assignments
            BEGIN SELECT RAISE(ABORT, 'test late rejection'); END;""")
        self.assert_rejected_without_changes(self.apply, sqlite3.IntegrityError)

    def test_callers_progress_timeout_is_respected_and_rolls_back(self):
        before = event.database_evidence(self.db)
        late = [False]
        def trace(sql):
            if sql.startswith('INSERT INTO "staff_event_assignments"'):
                late[0] = True
        self.db.set_trace_callback(trace)
        self.db.set_progress_handler(lambda: int(late[0]), 100)
        try:
            with self.assertRaisesRegex(sqlite3.OperationalError, "interrupted"):
                self.apply()
        finally:
            self.db.set_progress_handler(None, 0)
            self.db.set_trace_callback(None)
        self.assertTrue(late[0], "Interrupt only after the operation reaches the final insert")
        self.assertFalse(self.db.in_transaction)
        self.assertEqual(event.database_evidence(self.db), before)

    def test_active_caller_transaction_is_not_committed_or_rolled_back(self):
        self.db.execute('INSERT INTO "unrelated evidence" (value) VALUES ("caller work")')
        before = event.database_evidence(self.db)
        with self.assertRaises(event.GuardError):
            self.apply()
        self.assertTrue(self.db.in_transaction)
        self.assertEqual(event.database_evidence(self.db), before)

    def test_sqlite_row_factory_is_supported(self):
        self.db.row_factory = sqlite3.Row
        self.assertEqual(self.apply()["status"], "inserted")
        self.assertEqual(self.apply()["status"], "already_present")

    def test_invalid_flyer_and_timestamp_rejected(self):
        for flyer in (b"", b"not jpeg", bytearray(FLYER), b"\xff\xd8\xffbad", b"\xff\xd8\xff" + b"x" * 1_500_000 + b"\xff\xd9"):
            with self.subTest(flyer_size=len(flyer)):
                self.assert_rejected_without_changes(lambda: self.apply(flyer))
        for now in ("yesterday", "2026-10-19", "2026-10-19T14:00:00Z", "2026-10-19T14:00:00.000+00:00"):
            with self.subTest(now=now):
                self.assert_rejected_without_changes(lambda: self.apply(now=now))

    def test_supplied_original_flyer_when_available(self):
        path = REPOSITORY.parent / "IMG_1463.jpeg"
        if not path.exists():
            self.skipTest("Original user flyer is an external operator input, not committed to source")
        flyer = path.read_bytes()
        self.assertEqual(len(flyer), 596491)
        self.assertEqual(hashlib.sha256(flyer).hexdigest(), "439ee63370dd489b55c2eda2eb98d7231ab6c185b72d2ab5c28ee8a7892e1d9f")
        self.assertEqual(self.apply(flyer)["status"], "inserted")
        self.assertEqual(self.apply(flyer)["status"], "already_present")


if __name__ == "__main__":
    unittest.main()


class PlanCopyTests(unittest.TestCase):
    def setUp(self):
        self.db = migrated_database()
        event.insert_event(self.db, FLYER, actor_account_id=OWNER, organizer_account_id=None, now=NOW)
        self.fingerprint = event.schema_fingerprint(self.db)
    def tearDown(self):
        self.db.close()
    def test_updates_only_descriptions_and_reruns_without_change(self):
        before = event.database_evidence(self.db, exclude={"curated_event_records":{"id":event.EVENT_ID}, "party_submissions":{"id":event.SUBMISSION_ID}})
        self.assertEqual(event.update_plan_copy(self.db, expected_schema_fingerprint=self.fingerprint)["status"], "copy_updated")
        self.assertEqual(self.db.execute("SELECT curation_note FROM curated_event_records WHERE id=?", (event.EVENT_ID,)).fetchone()[0], event.PLAN_COPY)
        self.assertEqual(before, event.database_evidence(self.db, exclude={"curated_event_records":{"id":event.EVENT_ID}, "party_submissions":{"id":event.SUBMISSION_ID}}))
        complete = event.database_evidence(self.db)
        self.assertEqual(event.update_plan_copy(self.db, expected_schema_fingerprint=self.fingerprint)["status"], "copy_already_current")
        self.assertEqual(complete, event.database_evidence(self.db))
    def test_rejects_unreviewed_description(self):
        self.db.execute("UPDATE curated_event_records SET curation_note='changed' WHERE id=?", (event.EVENT_ID,));self.db.commit()
        before=event.database_evidence(self.db)
        with self.assertRaises(event.GuardError):event.update_plan_copy(self.db, expected_schema_fingerprint=self.fingerprint)
        self.assertEqual(before,event.database_evidence(self.db))
    def test_rolls_back_unexpected_trigger_effect(self):
        self.db.executescript("CREATE TRIGGER unexpected_copy AFTER UPDATE OF curation_note ON curated_event_records BEGIN UPDATE event_registration_settings SET capacity=199; END;")
        before=event.database_evidence(self.db)
        with self.assertRaises(event.GuardError):event.update_plan_copy(self.db, expected_schema_fingerprint=event.schema_fingerprint(self.db))
        self.assertEqual(before,event.database_evidence(self.db))
