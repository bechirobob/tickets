"""Exact Pink Edition correction: isolated SQLite, no host or customer access."""
import importlib.util
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("code-release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SQL = b"-- Owner-confirmed Pink Edition flyer, date and GMT registration opening.\n-- Preserve bookings, inventory, host assignments and registration policies.\nUPDATE curated_event_records\nSET starts_at = '2026-10-25T14:00:00.000Z',\n    ends_at = '2026-10-25T22:00:00.000Z',\n    schedule_status = 'confirmed', schedule_label = NULL,\n    sales_open_at = '2026-10-12T00:00:00.000Z',\n    sales_close_at = '2026-10-25T14:00:00.000Z',\n    image_url = '/events/on-the-guest-list-20261025.webp',\n    venue = 'Asana Bar & Kitchen', area = 'Kempinski Hotel Gold Coast City, Accra',\n    lineup = '',\n    curation_note = 'Club House Inc brings the Pink Edition to Asana. Sunday 25 October, 2\xe2\x80\x9310 PM. Light pink and white. Free mimosas till 5 PM. Tell the group chat.',\n    updated_at = CURRENT_TIMESTAMP\nWHERE slug = 'sun-chasers-labadi' AND status = 'published' AND removed_at IS NULL;\n--> statement-breakpoint\nUPDATE event_registration_settings\nSET accepting = 1, allow_undated_rsvp = 0, updated_at = CURRENT_TIMESTAMP\nWHERE event_slug = 'sun-chasers-labadi' AND mode = 'rsvp'\n  AND EXISTS (SELECT 1 FROM curated_event_records WHERE slug = 'sun-chasers-labadi' AND status = 'published' AND removed_at IS NULL);\n--> statement-breakpoint\nUPDATE party_submissions\nSET starts_at = '2026-10-25T14:00:00.000Z', ends_at = '2026-10-25T22:00:00.000Z',\n    venue_name = 'Asana Bar & Kitchen', area = 'Kempinski Hotel Gold Coast City, Accra', lineup = '',\n    updated_at = CURRENT_TIMESTAMP\nWHERE id IN (SELECT submission_id FROM curated_event_records WHERE slug = 'sun-chasers-labadi' AND status = 'published' AND removed_at IS NULL);\n--> statement-breakpoint\nUPDATE event_updates\nSET title = 'Sunday 25 October is sorted',\n    body = 'On The Guest List \xc2\xb7 Pink Edition. Sunday 25 October, 2 PM to 10 PM GMT at Asana Bar & Kitchen, Kempinski Hotel Gold Coast City, Accra. RSVP opens 12 October at 12 AM GMT. Light pink and white. Free mimosas till 5 PM.',\n    published_by = 'BeCore Tickets'\nWHERE id = 'update:sun-chasers-labadi:preview' AND event_slug = 'sun-chasers-labadi';\n"

# Exact trigger SQL from migrations 0035/0037/0038/0043/0056; hashes verified
# independently against the live schema on 2026-10-11.
BUSINESS_TRIGGERS = ["CREATE TRIGGER `apple_wallet_event_refresh` AFTER UPDATE OF `title`,`venue`,`area`,`starts_at`,`ends_at`,`event_state`,`schedule_status`,`removed_at` ON `curated_event_records`\nBEGIN\n  UPDATE apple_wallet_update_clock SET value=value+1 WHERE id=1 AND EXISTS (SELECT 1 FROM apple_wallet_passes WHERE event_slug=NEW.slug);\n  UPDATE apple_wallet_passes SET update_tag=(SELECT value FROM apple_wallet_update_clock WHERE id=1),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE event_slug=NEW.slug;\nEND", "CREATE TRIGGER curated_events_verify_insert\nAFTER INSERT ON curated_event_records\nWHEN NEW.status IN ('published', 'scheduled') AND NEW.is_test_event = 0 AND NEW.is_verified = 0\nBEGIN\n  UPDATE curated_event_records SET is_verified = 1 WHERE id = NEW.id;\nEND", "CREATE TRIGGER curated_events_verify_update\nAFTER UPDATE OF status, is_test_event, is_verified ON curated_event_records\nWHEN NEW.status IN ('published', 'scheduled') AND NEW.is_test_event = 0 AND NEW.is_verified = 0\nBEGIN\n  UPDATE curated_event_records SET is_verified = 1 WHERE id = NEW.id;\nEND", "CREATE TRIGGER operations_cancelled_event_guard\nBEFORE UPDATE OF event_state ON curated_event_records\nWHEN OLD.event_state = 'cancelled' AND NEW.event_state <> 'cancelled'\nBEGIN\n  SELECT RAISE(ABORT, 'A cancelled event cannot be reopened through the event editor.');\nEND", "CREATE TRIGGER removed_event_stays_removed BEFORE UPDATE ON curated_event_records\nWHEN OLD.removed_at IS NOT NULL AND (NEW.removed_at IS NULL OR NEW.status <> 'unpublished')\nBEGIN SELECT RAISE(ABORT, 'Removed events cannot be republished'); END", "CREATE TRIGGER owner_event_draft_submitted AFTER UPDATE OF status ON party_submissions\nWHEN NEW.status='submitted' AND OLD.status='draft'\nBEGIN\n INSERT OR IGNORE INTO owner_approval_outbox(kind,target_id) VALUES ('event',NEW.id);\nEND", "CREATE TRIGGER owner_event_review_created AFTER INSERT ON party_submissions\nWHEN NEW.status='submitted'\nBEGIN\n INSERT OR IGNORE INTO owner_approval_outbox(kind,target_id) VALUES ('event',NEW.id);\nEND"]

class PinkEditionMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.database = self.root / "tickets.sqlite"
        with closing(sqlite3.connect(self.database)) as db, db:
            db.executescript("""
                CREATE TABLE curated_event_records (id TEXT PRIMARY KEY, submission_id TEXT, slug TEXT, status TEXT, removed_at TEXT,
                    starts_at TEXT, ends_at TEXT, schedule_status TEXT, schedule_label TEXT, sales_open_at TEXT, sales_close_at TEXT,
                    image_url TEXT, venue TEXT, area TEXT, lineup TEXT, curation_note TEXT, updated_at TEXT, capacity INTEGER, organizer_owner_id TEXT);
                INSERT INTO curated_event_records VALUES ('event','submission','sun-chasers-labadi','published',NULL,
                    'old','old','coming_soon','Coming soon',NULL,NULL,'old','old','old','Cuppy','Kofi Bills','before',100,'owner');
                INSERT INTO curated_event_records SELECT 'other','other','other',status,removed_at,starts_at,ends_at,schedule_status,
                    schedule_label,sales_open_at,sales_close_at,image_url,venue,area,lineup,curation_note,updated_at,capacity,organizer_owner_id FROM curated_event_records;
                CREATE TABLE event_registration_settings (event_slug TEXT PRIMARY KEY, mode TEXT, accepting INTEGER, allow_undated_rsvp INTEGER,
                    updated_at TEXT, capacity INTEGER, approval_required INTEGER, room_access INTEGER);
                INSERT INTO event_registration_settings VALUES ('sun-chasers-labadi','rsvp',0,1,'before',100,1,1);
                CREATE TABLE party_submissions (id TEXT PRIMARY KEY, starts_at TEXT, ends_at TEXT, venue_name TEXT, area TEXT, lineup TEXT, updated_at TEXT, contact_email TEXT);
                INSERT INTO party_submissions VALUES ('submission','old','old','old','old','Cuppy','before','preserved@example.test');
                CREATE TABLE event_updates (id TEXT PRIMARY KEY, event_slug TEXT, title TEXT, body TEXT, published_by TEXT, pinned INTEGER);
                INSERT INTO event_updates VALUES ('update:sun-chasers-labadi:preview','sun-chasers-labadi','old','old','old',1);
                CREATE TABLE orders (id TEXT PRIMARY KEY, status TEXT);
                INSERT INTO orders VALUES ('preserved-order','paid');
                CREATE TABLE _bct_handover_state(id INTEGER PRIMARY KEY CHECK(id=1), frozen INTEGER NOT NULL CHECK(frozen IN (0,1)), transfer_id TEXT NOT NULL);
                INSERT INTO _bct_handover_state VALUES(1,0,'preserved-transfer');
            """)
            for table in ('curated_event_records','event_registration_settings','party_submissions','event_updates'):
                for operation in ('insert','update','delete'):
                    name = '_bct_guard_' + table + '_' + operation
                    db.execute('CREATE TRIGGER "' + name + '" BEFORE ' + operation.upper() + ' ON "' + table
                        + '" WHEN (SELECT frozen FROM _bct_handover_state WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,\'Source writer is paused for verified handover\'); END')
        with closing(sqlite3.connect(self.database)) as db, db:
            db.executescript("""
                ALTER TABLE curated_event_records ADD COLUMN is_test_event INTEGER DEFAULT 0;
                ALTER TABLE curated_event_records ADD COLUMN is_verified INTEGER DEFAULT 1;
                ALTER TABLE curated_event_records ADD COLUMN event_state TEXT DEFAULT 'scheduled';
                ALTER TABLE curated_event_records ADD COLUMN title TEXT DEFAULT 'Preserved title';
                ALTER TABLE party_submissions ADD COLUMN status TEXT DEFAULT 'published';
                CREATE TABLE owner_approval_outbox (kind TEXT, target_id TEXT);
                CREATE TABLE apple_wallet_update_clock (id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL);
                INSERT INTO apple_wallet_update_clock VALUES (1,17);
                CREATE TABLE apple_wallet_passes (id TEXT PRIMARY KEY, event_slug TEXT, update_tag INTEGER, updated_at TEXT, last_pushed_tag INTEGER DEFAULT 9);
                INSERT INTO apple_wallet_passes VALUES ('unrelated-pass','other',17,'preserved',9);
            """)
            for sql in BUSINESS_TRIGGERS:
                db.execute(sql)
            for table in ('apple_wallet_passes','apple_wallet_update_clock'):
                for operation in ('insert','update','delete'):
                    name = '_bct_guard_' + table + '_' + operation
                    db.execute('CREATE TRIGGER "' + name + '" BEFORE ' + operation.upper() + ' ON "' + table
                        + '" WHEN (SELECT frozen FROM _bct_handover_state WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,\'Source writer is paused for verified handover\'); END')
        self.database.chmod(0o600)
        self.specification = release.migration_plan([release.PINK_EDITION_PATH])[0]

    def migrate(self, staging='migration', raw=SQL):
        return release.migrate_database(self.database, self.root / staging, [(self.specification, raw)])

    def test_confirmed_details_preserve_capacity_approval_host_and_bookings(self):
        result = self.migrate()
        self.assertEqual(result['publicEventCorrection']['eventSlug'], 'sun-chasers-labadi')
        with closing(sqlite3.connect(self.database)) as db, db:
            self.assertEqual(db.execute("SELECT starts_at,ends_at,sales_open_at,lineup,capacity,organizer_owner_id FROM curated_event_records WHERE id='event'").fetchone(),
                ('2026-10-25T14:00:00.000Z','2026-10-25T22:00:00.000Z','2026-10-12T00:00:00.000Z','',100,'owner'))
            self.assertEqual(db.execute("SELECT starts_at,lineup FROM curated_event_records WHERE id='other'").fetchone(), ('old','Cuppy'))
            self.assertEqual(db.execute("SELECT accepting,allow_undated_rsvp,capacity,approval_required,room_access FROM event_registration_settings").fetchone(),(1,0,100,1,1))
            self.assertEqual(db.execute("SELECT * FROM orders").fetchall(), [('preserved-order','paid')])
            self.assertEqual(db.execute("SELECT contact_email FROM party_submissions").fetchone(), ('preserved@example.test',))
            self.assertEqual(db.execute("SELECT * FROM _bct_handover_state").fetchall(),[(1,0,'preserved-transfer')])
            self.assertEqual(db.execute("SELECT * FROM apple_wallet_update_clock").fetchall(), [(1,17)])
            self.assertEqual(db.execute("SELECT * FROM apple_wallet_passes").fetchall(), [('unrelated-pass','other',17,'preserved',9)])
            self.assertEqual(db.execute("SELECT * FROM owner_approval_outbox").fetchall(), [])
        self.migrate('repeat')
        with closing(sqlite3.connect(self.root / 'migration/before.sqlite')) as backup, backup:
            self.assertEqual(backup.execute("SELECT starts_at FROM curated_event_records WHERE id='event'").fetchone(),('old',))

    def test_frozen_writer_is_rejected_without_event_changes(self):
        with closing(sqlite3.connect(self.database)) as db, db: db.execute('UPDATE _bct_handover_state SET frozen=1')
        with self.assertRaisesRegex(release.ReleaseError,'active VPS writer'): self.migrate()
        with closing(sqlite3.connect(self.database)) as db, db: self.assertEqual(db.execute("SELECT starts_at FROM curated_event_records WHERE id='event'").fetchone(),('old',))

    def test_unknown_trigger_and_missing_guard_are_rejected(self):
        with closing(sqlite3.connect(self.database)) as db, db: db.execute('DROP TRIGGER _bct_guard_event_updates_update')
        with self.assertRaisesRegex(release.ReleaseError,'writer guards'): self.migrate()
        with closing(sqlite3.connect(self.database)) as db, db: self.assertEqual(db.execute("SELECT starts_at FROM curated_event_records WHERE id='event'").fetchone(),('old',))

    def test_altered_sql_is_rejected_before_backup_or_write(self):
        with self.assertRaisesRegex(release.ReleaseError,'exact reviewed source'): self.migrate(raw=SQL+b'\nDELETE FROM orders;')
        self.assertFalse((self.root/'migration').exists())

    def test_existing_target_wallet_pass_preserves_exact_refresh_and_unrelated_data(self):
        with closing(sqlite3.connect(self.database)) as db, db:
            db.execute("INSERT INTO apple_wallet_passes VALUES ('target-pass','sun-chasers-labadi',17,'before',9)")
        self.migrate()
        with closing(sqlite3.connect(self.database)) as db, db:
            self.assertEqual(db.execute("SELECT * FROM apple_wallet_update_clock").fetchall(), [(1,18)])
            row = db.execute("SELECT update_tag,updated_at,last_pushed_tag FROM apple_wallet_passes WHERE id='target-pass'").fetchone()
            self.assertEqual((row[0],row[2]), (18,9))
            self.assertRegex(row[1], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$')
            self.assertEqual(db.execute("SELECT * FROM apple_wallet_passes WHERE id='unrelated-pass'").fetchone(), ('unrelated-pass','other',17,'preserved',9))
        self.migrate('repeat')
        with closing(sqlite3.connect(self.database)) as db, db:
            self.assertEqual(db.execute("SELECT value FROM apple_wallet_update_clock").fetchone(), (19,))
            self.assertEqual(db.execute("SELECT update_tag FROM apple_wallet_passes WHERE id='target-pass'").fetchone(), (19,))

    def test_every_known_business_trigger_requires_its_exact_sql(self):
        with closing(sqlite3.connect(self.database)) as db, db:
            triggers = db.execute("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name NOT LIKE '_bct_guard_%'").fetchall()
        self.assertEqual(len(triggers), 7)
        for index, (name, sql) in enumerate(triggers):
            with self.subTest(trigger=name):
                with closing(sqlite3.connect(self.database)) as db, db:
                    db.execute('DROP TRIGGER "' + name + '"')
                    db.execute(sql.replace('BEGIN', 'BEGIN /* changed */', 1))
                with self.assertRaisesRegex(release.ReleaseError, 'business triggers'):
                    self.migrate('changed-' + str(index))
                with closing(sqlite3.connect(self.database)) as db, db:
                    self.assertEqual(db.execute("SELECT starts_at FROM curated_event_records WHERE id='event'").fetchone(), ('old',))
                    db.execute('DROP TRIGGER "' + name + '"')
                    db.execute(sql)

    def test_unknown_wallet_trigger_is_rejected_before_event_write(self):
        with closing(sqlite3.connect(self.database)) as db, db:
            db.execute('CREATE TRIGGER unexpected AFTER UPDATE ON apple_wallet_passes BEGIN DELETE FROM orders; END')
        with self.assertRaisesRegex(release.ReleaseError, 'business triggers'):
            self.migrate()
        with closing(sqlite3.connect(self.database)) as db, db:
            self.assertEqual(db.execute("SELECT starts_at FROM curated_event_records WHERE id='event'").fetchone(), ('old',))
            self.assertEqual(db.execute('SELECT * FROM orders').fetchall(), [('preserved-order','paid')])

    def test_missing_known_business_trigger_is_rejected(self):
        with closing(sqlite3.connect(self.database)) as db, db:
            db.execute('DROP TRIGGER removed_event_stays_removed')
        with self.assertRaisesRegex(release.ReleaseError, 'business triggers'):
            self.migrate()

    def test_direct_wallet_write_is_not_authorized(self):
        with closing(sqlite3.connect(self.database)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            with self.assertRaises(sqlite3.DatabaseError):
                release.confirm_pink_edition(db, b'UPDATE apple_wallet_update_clock SET value=value+1 WHERE id=1')
            db.rollback()
            self.assertEqual(db.execute('SELECT * FROM apple_wallet_update_clock').fetchall(), [(1,17)])

    def test_missing_wallet_writer_guard_is_rejected(self):
        with closing(sqlite3.connect(self.database)) as db, db:
            db.execute('DROP TRIGGER _bct_guard_apple_wallet_passes_update')
        with self.assertRaisesRegex(release.ReleaseError, 'writer guards'):
            self.migrate()

    def test_injected_insert_delete_and_unapproved_event_column_are_denied(self):
        for raw in (b"INSERT INTO orders VALUES ('injected','paid')",
                    b"DELETE FROM apple_wallet_passes",
                    b"UPDATE curated_event_records SET is_verified=0 WHERE id='event'"):
            with self.subTest(sql=raw), closing(sqlite3.connect(self.database)) as db, db:
                db.execute('BEGIN IMMEDIATE')
                with self.assertRaises(sqlite3.DatabaseError):
                    release.confirm_pink_edition(db, raw)
                db.rollback()

    def test_postcondition_failure_rolls_back_event_wallet_and_clock(self):
        with closing(sqlite3.connect(self.database)) as db, db:
            db.execute("INSERT INTO apple_wallet_passes VALUES ('target-pass','sun-chasers-labadi',17,'before',9)")
            before = {name: db.execute('SELECT * FROM "'+name+'"').fetchall() for name in
                      ('curated_event_records','party_submissions','event_registration_settings','event_updates',
                       'apple_wallet_passes','apple_wallet_update_clock','_bct_handover_state')}
        original = release.confirm_pink_edition
        def fail_after_updates(db, raw):
            original(db, raw)
            self.assertEqual(db.execute('SELECT value FROM apple_wallet_update_clock').fetchone(), (18,))
            raise release.ReleaseError('injected postcondition failure')
        with patch.object(release, 'confirm_pink_edition', side_effect=fail_after_updates):
            with self.assertRaisesRegex(release.ReleaseError, 'injected postcondition failure'):
                self.migrate()
        with closing(sqlite3.connect(self.database)) as db, db:
            self.assertEqual(before, {name: db.execute('SELECT * FROM "'+name+'"').fetchall() for name in before})
