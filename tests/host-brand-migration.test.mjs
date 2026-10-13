import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migrationName = '0067_host_brand_identity.sql';
const directory = new URL('../drizzle/', import.meta.url);
const migration = readFileSync(new URL(migrationName, directory), 'utf8');

function beforeBrandMigration() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const name of readdirSync(directory).filter(name => name.endsWith('.sql') && name < migrationName).sort()) {
    db.exec(readFileSync(new URL(name, directory), 'utf8'));
  }
  return db;
}

function rows(db, table) {
  return db.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}"`).all();
}

test('the real brand migration preserves every event, organizer, finance and access table and existing host identity', () => {
  const db = beforeBrandMigration();
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'hosts' ORDER BY name").all();
    const before = new Map(tables.map(({ name }) => [name, rows(db, name)]));
    const beforeHosts = rows(db, 'hosts');
    const originalColumns = Object.keys(beforeHosts[0]);
    db.exec(migration);
    for (const [table, content] of before) assert.deepEqual(rows(db, table), content, `${table} must not change`);
    const afterHosts = rows(db, 'hosts');
    assert.equal(afterHosts.length, beforeHosts.length);
    for (const beforeHost of beforeHosts) {
      const afterHost = afterHosts.find(host => host.id === beforeHost.id);
      assert.ok(afterHost);
      for (const column of originalColumns) {
        if (column === 'updated_at' && beforeHost.id === 'host:kofi-bills') continue;
        assert.deepEqual(afterHost[column], beforeHost[column], `${beforeHost.id}.${column} must not change`);
      }
      const target = beforeHost.id === 'host:kofi-bills' && beforeHost.slug === 'kofi-bills';
      assert.equal(afterHost.brand_name, target ? 'The Yorke Way' : null);
      assert.equal(afterHost.brand_logo_url, target ? '/hosts/the-yorke-way.svg' : null);
    }
    const brandColumns = db.prepare('PRAGMA table_info(hosts)').all().filter(column => column.name.startsWith('brand_'));
    assert.deepEqual(brandColumns.map(column => [column.name, column.type, column.notnull, column.dflt_value]), [
      ['brand_name', 'TEXT', 0, null], ['brand_logo_url', 'TEXT', 0, null],
    ]);
  } finally {
    db.close();
  }
});

test('the migration requires both the exact host id and slug, never a matching display name or partial identity', () => {
  const db = beforeBrandMigration();
  try {
    db.exec("UPDATE hosts SET id = 'host:matching-slug-only' WHERE id = 'host:kofi-bills'");
    const insert = db.prepare(`INSERT INTO hosts (id, slug, name, bio, city, verification_status, created_at, updated_at)
      VALUES (?, ?, 'Kofi Bills', 'An independent profile', 'Accra', 'reviewed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
    insert.run('host:kofi-bills', 'different-slug');
    insert.run('host:matching-name-only', 'matching-name-only');
    db.exec(migration);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM hosts WHERE brand_name IS NOT NULL OR brand_logo_url IS NOT NULL').get().count, 0);
  } finally {
    db.close();
  }
});

test('the migration is safe when the specific host is absent', () => {
  const db = beforeBrandMigration();
  try {
    db.exec("DELETE FROM hosts WHERE id = 'host:kofi-bills'");
    const before = rows(db, 'hosts');
    db.exec(migration);
    assert.equal(rows(db, 'hosts').length, before.length);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM hosts WHERE brand_name IS NOT NULL OR brand_logo_url IS NOT NULL').get().count, 0);
  } finally {
    db.close();
  }
});

test('the circular logo embeds the approved original JPEG byte-for-byte and stays separate from the host portrait', () => {
  const svg = readFileSync(new URL('../public/hosts/the-yorke-way.svg', import.meta.url), 'utf8');
  const embedded = svg.match(/href="data:image\/jpeg;base64,([A-Za-z0-9+/=\s]+)"/);
  assert.ok(embedded, 'Use the supplied image, not a recreated brand mark');
  const original = Buffer.from(embedded[1], 'base64');
  assert.equal(original.length, 127004);
  // SHA-256 of the approved IMG_1432.jpeg, recorded independently of the SVG wrapper.
  assert.equal(createHash('sha256').update(original).digest('hex'), '0c59d6b196a9a81753d05dd3ebfa03ea2810bccc457533741c0c6e9e3a598216');
  assert.match(svg, /viewBox="199 420 771 771"/);
  assert.match(svg, /<circle cx="584\.5" cy="805\.5" r="385\.5"\s*\/>/);
  assert.match(svg, /clip-path="url\(#logo\)"/);
  assert.match(svg, /<title>The Yorke Way<\/title>/);
  assert.doesNotMatch(svg, /<script|<foreignObject|\son[a-z]+\s*=|(?:href|src)="https?:/i);
  assert.ok(readFileSync(new URL('../public/hosts/kofi-bills.webp', import.meta.url)).length > 0, 'Keep the original personal portrait');
});
