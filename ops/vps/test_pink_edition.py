"""Exact Pink Edition correction: isolated SQLite, no host or customer access."""
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("code-release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SQL = b"-- Owner-confirmed Pink Edition flyer, date and GMT registration opening.\n-- Preserve bookings, inventory, host assignments and registration policies.\nUPDATE curated_event_records\nSET starts_at = '2026-10-25T14:00:00.000Z',\n    ends_at = '2026-10-25T22:00:00.000Z',\n    schedule_status = 'confirmed', schedule_label = NULL,\n    sales_open_at = '2026-10-12T00:00:00.000Z',\n    sales_close_at = '2026-10-25T14:00:00.000Z',\n    image_url = '/events/on-the-guest-list-20261025.webp',\n    venue = 'Asana Bar & Kitchen', area = 'Kempinski Hotel Gold Coast City, Accra',\n    lineup = '',\n    curation_note = 'Club House Inc brings the Pink Edition to Asana. Sunday 25 October, 2\xe2\x80\x9310 PM. Light pink and white. Free mimosas till 5 PM. Tell the group chat.',\n    updated_at = CURRENT_TIMESTAMP\nWHERE slug = 'sun-chasers-labadi' AND status = 'published' AND removed_at IS NULL;\n--> statement-breakpoint\nUPDATE event_registration_settings\nSET accepting = 1, allow_undated_rsvp = 0, updated_at = CURRENT_TIMESTAMP\nWHERE event_slug = 'sun-chasers-labadi' AND mode = 'rsvp'\n  AND EXISTS (SELECT 1 FROM curated_event_records WHERE slug = 'sun-chasers-labadi' AND status = 'published' AND removed_at IS NULL);\n--> statement-breakpoint\nUPDATE party_submissions\nSET starts_at = '2026-10-25T14:00:00.000Z', ends_at = '2026-10-25T22:00:00.000Z',\n    venue_name = 'Asana Bar & Kitchen', area = 'Kempinski Hotel Gold Coast City, Accra', lineup = '',\n    updated_at = CURRENT_TIMESTAMP\nWHERE id IN (SELECT submission_id FROM curated_event_records WHERE slug = 'sun-chasers-labadi' AND status = 'published' AND removed_at IS NULL);\n--> statement-breakpoint\nUPDATE event_updates\nSET title = 'Sunday 25 October is sorted',\n    body = 'On The Guest List \xc2\xb7 Pink Edition. Sunday 25 October, 2 PM to 10 PM GMT at Asana Bar & Kitchen, Kempinski Hotel Gold Coast City, Accra. RSVP opens 12 October at 12 AM GMT. Light pink and white. Free mimosas till 5 PM.',\n    published_by = 'BeCore Tickets'\nWHERE id = 'update:sun-chasers-labadi:preview' AND event_slug = 'sun-chasers-labadi';\n"

class PinkEditionMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.database = self.root / "tickets.sqlite"
        with sqlite3.connect(self.database) as db:
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
        self.database.chmod(0o600)
        self.specification = release.migration_plan([release.PINK_EDITION_PATH])[0]

    def migrate(self, staging='migration', raw=SQL):
        return release.migrate_database(self.database, self.root / staging, [(self.specification, raw)])

    def test_confirmed_details_preserve_capacity_approval_host_and_bookings(self):
        result = self.migrate()
        self.assertEqual(result['publicEventCorrection']['eventSlug'], 'sun-chasers-labadi')
        with sqlite3.connect(self.database) as db:
            self.assertEqual(db.execute("SELECT starts_at,ends_at,sales_open_at,lineup,capacity,organizer_owner_id FROM curated_event_records WHERE id='event'").fetchone(),
                ('2026-10-25T14:00:00.000Z','2026-10-25T22:00:00.000Z','2026-10-12T00:00:00.000Z','',100,'owner'))
            self.assertEqual(db.execute("SELECT starts_at,lineup FROM curated_event_records WHERE id='other'").fetchone(), ('old','Cuppy'))
            self.assertEqual(db.execute("SELECT accepting,allow_undated_rsvp,capacity,approval_required,room_access FROM event_registration_settings").fetchone(),(1,0,100,1,1))
            self.assertEqual(db.execute("SELECT * FROM orders").fetchall(), [('preserved-order','paid')])
            self.assertEqual(db.execute("SELECT contact_email FROM party_submissions").fetchone(), ('preserved@example.test',))
            self.assertEqual(db.execute("SELECT * FROM _bct_handover_state").fetchall(),[(1,0,'preserved-transfer')])
        self.migrate('repeat')
        with sqlite3.connect(self.root / 'migration/before.sqlite') as backup:
            self.assertEqual(backup.execute("SELECT starts_at FROM curated_event_records WHERE id='event'").fetchone(),('old',))

    def test_frozen_writer_is_rejected_without_event_changes(self):
        with sqlite3.connect(self.database) as db: db.execute('UPDATE _bct_handover_state SET frozen=1')
        with self.assertRaisesRegex(release.ReleaseError,'active VPS writer'): self.migrate()
        with sqlite3.connect(self.database) as db: self.assertEqual(db.execute("SELECT starts_at FROM curated_event_records WHERE id='event'").fetchone(),('old',))

    def test_unknown_trigger_and_missing_guard_are_rejected(self):
        with sqlite3.connect(self.database) as db: db.execute('DROP TRIGGER _bct_guard_event_updates_update')
        with self.assertRaisesRegex(release.ReleaseError,'writer guards'): self.migrate()
        with sqlite3.connect(self.database) as db: self.assertEqual(db.execute("SELECT starts_at FROM curated_event_records WHERE id='event'").fetchone(),('old',))

    def test_altered_sql_is_rejected_before_backup_or_write(self):
        with self.assertRaisesRegex(release.ReleaseError,'exact reviewed source'): self.migrate(raw=SQL+b'\nDELETE FROM orders;')
        self.assertFalse((self.root/'migration').exists())
