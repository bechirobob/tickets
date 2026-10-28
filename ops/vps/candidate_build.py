#!/usr/bin/env python3
"""Bounded same-run browser build transport, not production release admission.

The workflow supplies immutable artifact IDs and independent producer digests via
needs outputs. Receipts must later be authenticated against exact-attempt GitHub
jobs/logs before any release use. JSON/digests alone do not prove provenance.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import zipfile

import public_runtime_guard as privacy

SCHEMA = 'tickets-browser-build/v2'
RETRY_RECEIPT_SCHEMA = 'tickets-browser-build/v3'
PREFIX = 'TICKETS_BROWSER_BUILD_RECEIPT '
BROWSERS = ('desktop-chromium', 'mobile-chromium', 'mobile-webkit')
ARCHIVE = 'browser-build.zip'
MANIFEST = 'browser-build.json'
MAX_ARCHIVE = 256 * 1024 * 1024
MAX_EXPANDED = 512 * 1024 * 1024
MAX_FILES = 25000
MAX_MANIFEST = 8 * 1024 * 1024
SHA = re.compile(r'[a-f0-9]{40}\Z')
DIGEST = re.compile(r'[a-f0-9]{64}\Z')
NUMBER = re.compile(r'[1-9][0-9]{0,19}\Z')


class BuildError(ValueError):
    pass


def require(value, message):
    if not value:
        raise BuildError(message)


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def parse(raw):
    """Evidence and manifests deliberately permit integer JSON numbers only."""
    return _parse_json(raw, config=False)


def parse_config(raw):
    """Wrangler config also permits bounded finite decimals, never evidence."""
    return _parse_json(raw, config=True)


def _parse_json(raw, *, config):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'Duplicate JSON key')
            result[key] = value
        return result
    require(type(raw) in (str, bytes), 'JSON bytes required')
    require(len(raw.encode() if isinstance(raw, str) else raw) <= MAX_MANIFEST, 'JSON exceeds bound')
    try:
        def invalid_number(_):
            raise BuildError('Invalid JSON number')
        def config_number(token):
            # Generated configuration contains sampling rates such as 0.05.
            # Bound the token and magnitude; reject overflow and nonzero values
            # that underflow to zero instead of silently changing configuration.
            require(len(token) <= 128, 'Config number exceeds bound')
            number = float(token)
            require(math.isfinite(number) and abs(number) < 10**20,
                    'Config number must be finite and bounded')
            mantissa = token.lower().split('e', 1)[0]
            require(number != 0 or not any(char in '123456789' for char in mantissa),
                    'Config number underflows')
            return number
        value = json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid_number,
                           parse_float=config_number if config else invalid_number)
        pending, nodes = [(value, 0)], 0
        while pending:
            item, depth = pending.pop()
            nodes += 1
            require(depth <= 32 and nodes <= 200000, 'JSON nesting or inventory exceeds bound')
            if isinstance(item, dict):
                pending.extend((child, depth + 1) for child in item.values())
            elif isinstance(item, list):
                pending.extend((child, depth + 1) for child in item)
            elif type(item) is int:
                require(abs(item) < 10**20, 'JSON integer exceeds bound')
        return value
    except (ValueError, UnicodeError, TypeError, RecursionError) as error:
        raise BuildError('Invalid bounded JSON document') from error


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def regular(path, maximum):
    path = Path(path)
    require(not any(p.is_symlink() for p in (path, *path.parents)), 'Symlink input or ancestor')
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and 0 <= info.st_size <= maximum,
            'Input must be a bounded regular file without hardlinks')
    return info.st_size


def git(*args):
    env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null', GIT_NO_REPLACE_OBJECTS='1',
               GIT_NO_LAZY_FETCH='1', GIT_TERMINAL_PROMPT='0')
    try:
        return subprocess.check_output(['git', '--no-replace-objects', *args], env=env, timeout=60,
                                       text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.SubprocessError) as error:
        raise BuildError('Exact checkout or audit ancestry verification failed') from error


IDENTITY_KEYS = {'repository', 'source_sha', 'source_tree', 'workflow_sha', 'audit_trusted_base',
                 'run_id', 'run_attempt', 'lock_sha256', 'node', 'browsers'}


def matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def validate_identity(value):
    require(isinstance(value, dict) and set(value) == IDENTITY_KEYS, 'Invalid build identity schema')
    require(value['repository'] == 'bechirobob/tickets'
            and all(matches(SHA, value[key]) for key in
                    ('source_sha', 'source_tree', 'workflow_sha', 'audit_trusted_base'))
            and value['workflow_sha'] == value['source_sha']
            and value['audit_trusted_base'] != value['source_sha']
            and all(matches(NUMBER, value[key]) for key in ('run_id', 'run_attempt'))
            and matches(DIGEST, value['lock_sha256'])
            and isinstance(value['node'], str) and re.fullmatch(r'v22\.[0-9]+\.[0-9]+', value['node'])
            and value['browsers'] == list(BROWSERS), 'Invalid build identity')
    return value


def identity():
    env = os.environ
    require(env.get('GITHUB_REPOSITORY') == 'bechirobob/tickets', 'Unexpected repository')
    source, workflow = env.get('BECORE_RELEASE_SHA', ''), env.get('GITHUB_WORKFLOW_SHA', '')
    require(SHA.fullmatch(source) and SHA.fullmatch(workflow), 'Exact source and executed workflow SHA required')
    require(workflow == source, 'Executed workflow must be the exact source commit')
    baseline = env.get('BECORE_TRUSTED_BASE', '')
    require(matches(SHA, baseline) and baseline != source, 'Independent audit baseline required')
    require(git('cat-file', '-t', baseline) == 'commit', 'Audit baseline must be an immutable commit')
    require(git('rev-parse', 'HEAD') == source, 'Source checkout differs')
    git('merge-base', '--is-ancestor', baseline, source)
    git('merge-base', '--is-ancestor', baseline, 'origin/main')
    git('diff', '--no-ext-diff', '--no-textconv', '--quiet', 'HEAD', '--')
    git('diff', '--cached', '--no-ext-diff', '--no-textconv', '--quiet', 'HEAD', '--')
    run, attempt = env.get('GITHUB_RUN_ID', ''), env.get('GITHUB_RUN_ATTEMPT', '')
    require(NUMBER.fullmatch(run) and NUMBER.fullmatch(attempt), 'Exact run and attempt required')
    node = subprocess.check_output(['node', '--version'], text=True, timeout=10).strip()
    require(re.fullmatch(r'v22\.[0-9]+\.[0-9]+', node), 'Browser build requires Node 22')
    return validate_identity({'repository': env['GITHUB_REPOSITORY'], 'source_sha': source,
            'audit_trusted_base': baseline,
            'source_tree': git('rev-parse', 'HEAD^{tree}'), 'workflow_sha': workflow,
            'run_id': run, 'run_attempt': attempt, 'lock_sha256': digest('package-lock.json'),
            'node': node, 'browsers': list(BROWSERS)})


def safe_name(name):
    require(isinstance(name, str) and len(name.encode('utf-8')) <= 4096 and '\\' not in name and '\x00' not in name,
            'Invalid archive path')
    parts = name.split('/')
    require(len(parts) >= 3 and parts[:2] in (['dist', 'client'], ['dist', 'server'])
            and all(part not in ('', '.', '..') and not any(ord(c) < 32 or ord(c) == 127 for c in part) for part in parts)
            and str(PurePosixPath(name)) == name, 'Path outside browser build')
    privacy.safe_name('/'.join(parts[1:]))
    require(not any(part in ('node_modules', '.wrangler', 'test-results', 'playwright-report') for part in parts),
            'Private or non-build directory')
    return name


def package(directory, expected):
    validate_identity(expected)
    directory = Path(directory)
    require(not directory.exists(), 'Package directory already exists')
    entries = []
    total = 0
    for root in (Path('dist/client'), Path('dist/server')):
        require(root.is_dir() and not root.is_symlink(), 'Missing browser build root')
        for folder, dirs, files in os.walk(root, followlinks=False):
            require(not any((Path(folder) / name).is_symlink() for name in dirs), 'Linked build directory')
            for name in sorted(files):
                path = Path(folder) / name
                size = regular(path, MAX_EXPANDED)
                total += size
                with path.open('rb') as stream:
                    inspected_digest = privacy.hash_stream(stream, inspect=True).hex()
                entries.append({'path': safe_name(path.as_posix()), 'size': size, 'sha256': inspected_digest})
                require(total <= MAX_EXPANDED and len(entries) <= MAX_FILES, 'Build exceeds budget')
    require(entries and any(x['path'].startswith('dist/server/') for x in entries)
            and any(x['path'].startswith('dist/client/') for x in entries), 'Incomplete browser build')
    entries.sort(key=lambda x: x['path'])
    directory.mkdir(mode=0o700, parents=True)
    archive = directory / ARCHIVE
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
        for entry in entries:
            info = zipfile.ZipInfo(entry['path'])
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            with Path(entry['path']).open('rb') as stream, output.open(info, 'w') as target:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    target.write(chunk)
            require(digest(entry['path']) == entry['sha256'], 'Build changed during packaging')
    size = regular(archive, MAX_ARCHIVE)
    manifest = {'schema': SCHEMA, **expected, 'archive_sha256': digest(archive),
                'archive_bytes': size, 'expanded_bytes': total, 'files': entries}
    raw = canonical(manifest)
    require(len(raw) <= MAX_MANIFEST, 'Manifest exceeds budget')
    (directory / MANIFEST).write_bytes(raw)
    archive.chmod(0o400)
    return manifest


def validate(directory, expected, archive_digest, manifest_digest):
    validate_identity(expected)
    directory = Path(directory)
    require(matches(DIGEST, archive_digest) and matches(DIGEST, manifest_digest),
            'Independent producer digests required')
    archive, manifest_path = directory / ARCHIVE, directory / MANIFEST
    regular(archive, MAX_ARCHIVE)
    regular(manifest_path, MAX_MANIFEST)
    require(digest(archive) == archive_digest and digest(manifest_path) == manifest_digest,
            'Producer build digest differs')
    raw = manifest_path.read_bytes()
    manifest = parse(raw)
    require(isinstance(manifest, dict) and raw == canonical(manifest), 'Noncanonical manifest')
    require(set(manifest) == {'schema', *expected, 'archive_sha256', 'archive_bytes', 'expanded_bytes', 'files'}
            and manifest['schema'] == SCHEMA
            and all(manifest[key] == value for key, value in expected.items()), 'Build identity differs; rerun all jobs')
    require(manifest['archive_sha256'] == archive_digest
            and type(manifest['archive_bytes']) is int
            and manifest['archive_bytes'] == archive.stat().st_size, 'Archive size/identity differs')
    entries = manifest['files']
    require(isinstance(entries, list) and 0 < len(entries) <= MAX_FILES, 'Invalid file inventory')
    inventory, total = {}, 0
    for entry in entries:
        require(isinstance(entry, dict) and set(entry) == {'path', 'size', 'sha256'}, 'Invalid file record')
        name = safe_name(entry['path'])
        require(name not in inventory and type(entry['size']) is int and 0 <= entry['size'] <= MAX_EXPANDED
                and isinstance(entry['sha256'], str) and DIGEST.fullmatch(entry['sha256']), 'Invalid duplicate/file digest')
        inventory[name] = entry
        total += entry['size']
    require(all(str(parent) not in inventory for name in inventory for parent in PurePosixPath(name).parents),
            'File inventory has ancestor collisions')
    require(type(manifest['expanded_bytes']) is int and total == manifest['expanded_bytes'] <= MAX_EXPANDED,
            'Expanded build exceeds budget')
    with zipfile.ZipFile(archive) as source:
        seen = set()
        require(len(source.infolist()) == len(inventory) <= MAX_FILES and not source.comment,
                'Archive member count or comment differs')
        for member in source.infolist():
            name = safe_name(member.filename)
            require(name not in seen and name in inventory, 'Unexpected archive member')
            verify_member(member, inventory[name])
            seen.add(name)
            with source.open(member) as stream:
                value = hashlib.sha256()
                count = 0
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    count += len(chunk)
                    require(count <= inventory[name]['size'], 'Archive file exceeds bound')
                    value.update(chunk)
                require(count == inventory[name]['size'] and value.hexdigest() == inventory[name]['sha256'],
                        'Archive content differs')
        require(seen == set(inventory), 'Archive inventory incomplete')
    return manifest


def verify_member(member, entry):
    require(member.orig_filename == member.filename and not member.is_dir()
            and member.create_system == 3
            and member.external_attr == (stat.S_IFREG | 0o644) << 16
            and not member.flag_bits & ~0x808  # UTF-8 names/data descriptor only
            and not member.extra and not member.comment
            and member.compress_type == zipfile.ZIP_DEFLATED
            and member.file_size == entry['size']
            and 0 <= member.compress_size <= MAX_ARCHIVE,
            'Archive type, mode, encoding or size differs')


def restore(directory, expected, archive_digest, manifest_digest):
    manifest = validate(directory, expected, archive_digest, manifest_digest)
    require(not os.path.lexists('dist'), 'Restore requires absent dist; never overwrite checkout data')
    # Validation completes before any archive bytes are written. No extractall:
    # create only private directories and regular files with exclusive creation.
    inventory = {entry['path']: entry for entry in manifest['files']}
    seen = set()
    with zipfile.ZipFile(Path(directory) / ARCHIVE) as source:
        for member in source.infolist():
            name = safe_name(member.filename)
            require(name in inventory and name not in seen, 'Archive changed after validation')
            verify_member(member, inventory[name])
            seen.add(name)
            path = Path(name)
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            require(not any(p.is_symlink() for p in path.parents), 'Restore ancestor changed')
            count = 0
            with path.open('xb') as output, source.open(member) as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    count += len(chunk)
                    require(count <= inventory[name]['size'], 'Changed archive exceeds file bound')
                    output.write(chunk)
            path.chmod(0o644)
            require(count == inventory[name]['size'] and digest(path) == inventory[name]['sha256'],
                    'Archive changed during extraction')
    require(seen == set(inventory) and digest(Path(directory) / ARCHIVE) == archive_digest,
            'Archive changed during restoration')
    config_path = Path('dist/server/wrangler.json')
    regular(config_path, MAX_MANIFEST)
    config = parse_config(config_path.read_bytes())
    require(isinstance(config, dict) and isinstance(config.get('vars'), dict)
            and config['vars'].get('RELEASE_SHA') == expected['source_sha'], 'Embedded release identity differs')
    return manifest


def receipt(kind, manifest, artifact_id, artifact_digest, manifest_digest, browser=None):
    require(isinstance(manifest, dict) and manifest.get('schema') == SCHEMA, 'Version 2 build manifest required')
    validate_identity({key: manifest.get(key) for key in IDENTITY_KEYS})
    require(matches(DIGEST, manifest.get('archive_sha256')) and matches(DIGEST, manifest_digest),
            'Exact manifest and archive digests required')
    require(matches(NUMBER, artifact_id) and matches(DIGEST, artifact_digest), 'Immutable artifact identity required')
    require(kind in ('producer', 'consumer') and ((kind == 'producer' and browser is None)
            or (kind == 'consumer' and browser in BROWSERS)), 'Invalid receipt role')
    return {'schema': SCHEMA, 'kind': kind, 'browser': browser,
            **{key: manifest[key] for key in ('repository', 'source_sha', 'source_tree', 'workflow_sha', 'audit_trusted_base', 'run_id', 'run_attempt')},
            'artifact_id': artifact_id, 'artifact_digest': artifact_digest,
            'archive_sha256': manifest['archive_sha256'], 'manifest_sha256': manifest_digest}


def retry_producer_identity(current, producer_attempt):
    """Separate transport identity only; authenticated admission decides eligibility.

    Never relax the v2 validator. A retry is exactly original producer attempt 1
    and consumer attempt 2 in the same run; every other independently measured
    identity field (source/tree/workflow/lock/Node/browsers/baseline) stays exact.
    """
    validate_identity(current)
    require(producer_attempt == '1' and current['run_attempt'] == '2',
            'Retry transport requires producer attempt 1 and consumer attempt 2')
    return validate_identity({**current, 'run_attempt': producer_attempt})


def restore_retry(directory, current, producer_attempt, archive_digest, manifest_digest):
    producer = retry_producer_identity(current, producer_attempt)
    return restore(directory, producer, archive_digest, manifest_digest)


def retry_receipt(manifest, current, producer_attempt, artifact_id, artifact_digest,
                  manifest_digest, browser):
    producer = retry_producer_identity(current, producer_attempt)
    require(isinstance(manifest, dict)
            and all(manifest.get(key) == value for key, value in producer.items()),
            'Retry producer identity differs')
    value = receipt('consumer', manifest, artifact_id, artifact_digest, manifest_digest, browser)
    return {**value, 'schema': RETRY_RECEIPT_SCHEMA,
            'run_attempt': current['run_attempt'], 'producer_attempt': producer_attempt}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('package', 'restore', 'restore-retry', 'receipt'))
    parser.add_argument('--directory', required=True)
    parser.add_argument('--browser', choices=BROWSERS)
    args = parser.parse_args()
    expected = identity()
    if args.command == 'package':
        manifest = package(args.directory, expected)
        values = {'producer_attempt': manifest['run_attempt'],
                  'archive_digest': manifest['archive_sha256'],
                  'manifest_digest': digest(Path(args.directory) / MANIFEST)}
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            for key, value in values.items():
                print(f'{key}={value}', file=output)
    elif args.command == 'restore-retry':
        producer_attempt = os.environ.get('BUILD_PRODUCER_ATTEMPT', '')
        manifest = restore_retry(args.directory, expected, producer_attempt,
                                 os.environ['BUILD_ARCHIVE_DIGEST'], os.environ['BUILD_MANIFEST_DIGEST'])
        value = retry_receipt(manifest, expected, producer_attempt,
                              os.environ['BUILD_ARTIFACT_ID'], os.environ['BUILD_ARTIFACT_DIGEST'],
                              os.environ['BUILD_MANIFEST_DIGEST'], args.browser)
        print(PREFIX + canonical(value).decode().strip())
    else:
        operation = restore if args.command == 'restore' else validate
        manifest = operation(args.directory, expected, os.environ['BUILD_ARCHIVE_DIGEST'], os.environ['BUILD_MANIFEST_DIGEST'])
        value = receipt('consumer' if args.command == 'restore' else 'producer', manifest,
                        os.environ['BUILD_ARTIFACT_ID'], os.environ['BUILD_ARTIFACT_DIGEST'],
                        os.environ['BUILD_MANIFEST_DIGEST'], args.browser)
        print(PREFIX + canonical(value).decode().strip())


if __name__ == '__main__':
    main()
