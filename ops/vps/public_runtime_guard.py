"""Fail-closed public package boundary, not a guarantee of secret-free source.

Only generated runtime outputs and byte-matched approved copy origins are allowed.
No extraction or network access; rejection messages never include content or paths.
"""
import hashlib
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import shutil
import stat
import subprocess
import tarfile

MAX_MEMBERS = 150000
MAX_BYTES = 4 * 1024 ** 3
ROOT_DIRS = {'client', 'server', 'node_modules', 'migrations', 'operations', 'bin'}
ROOT_FILES = {'server.mjs', 'release.json', 'package.json'}
PRIVATE_NAMES = {'.env', '.envrc', '.dev.vars', '.npmrc', '.pypirc', '.netrc', '.git', '.aws', '.ssh', '.config',
                 'credentials', 'credentials.json', 'config.json', 'id_rsa', 'id_ed25519',
                 'state', 'backups', 'logs', '__pycache__'}
PRIVATE_SUFFIXES = ('.sqlite', '.sqlite3', '.db', '.db-wal', '.db-shm', '.sqlite-wal',
                    '.sqlite-shm', '.log', '.pem', '.key', '.p12', '.pfx', '.age', '.dump', '.bak',
                    '.enc', '.tar', '.gz', '.tgz', '.zip', '.7z', '.bz2', '.xz', '.zst')
# High-confidence literal signatures only. References to environment-variable
# names are allowed. This detects a bounded set of mistakes, not every secret.
PRIVATE_CONTENT = re.compile(rb'-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----(?:\r?\n|\\n|\\r\\n)[A-Za-z0-9+/=]{32,}|'
                             rb'gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255}|'
                             rb'(?i:aws_secret_access_key)[\"\']?\s*[:=]\s*[\"\']?[A-Za-z0-9/+=]{40}')


class PublicRuntimeError(RuntimeError):
    pass


def require(condition):
    if not condition:
        raise PublicRuntimeError('Public runtime package boundary failed; inspect locally before publishing.')


def safe_name(raw):
    require(isinstance(raw, str) and raw and '\\' not in raw and '\x00' not in raw)
    path = PurePosixPath(raw)
    require(not path.is_absolute() and '..' not in path.parts)
    name = str(path)
    for part in path.parts:
        lower = part.lower()
        require(lower not in PRIVATE_NAMES and not lower.startswith(('.env.', '.dev.vars.'))
                and not lower.endswith(PRIVATE_SUFFIXES))
    if name != '.':
        require(path.parts[0] in ROOT_DIRS or name in ROOT_FILES)
        require(not name.startswith('bin/') or name == 'bin/node')
        require(not name.endswith('.sql') or name.startswith('migrations/'))
    return name


def hash_stream(stream, *, inspect=False):
    digest, tail, first = hashlib.sha256(), b'', True
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        if inspect:
            # SQLite libraries legitimately embed this signature. A database
            # payload is identified by its file header, never a substring.
            require(not first or not chunk.startswith(b'SQLite format 3\x00'))
            require(PRIVATE_CONTENT.search(tail + chunk) is None)
            tail = chunk[-512:]
        first = False
        digest.update(chunk)
    return digest.digest()


def tracked_sources(root):
    result = subprocess.run(['git', 'ls-files', '-z', '--', 'ops/vps', 'drizzle'],
                            cwd=root, check=True, capture_output=True)
    return set(os.fsdecode(value) for value in result.stdout.split(b'\0') if value)


def validate_public_archive(archive_path, *, root=None, node=None):
    archive_path = Path(archive_path)
    info = archive_path.lstat()
    require(stat.S_ISREG(info.st_mode) and 0 < info.st_size < 2 * 1024 ** 3)
    root = Path.cwd() if root is None else Path(root)
    stage = root / 'dist-vps'
    require(stage.is_dir() and not stage.is_symlink())
    tracked = tracked_sources(root)
    node = Path(node or shutil.which('node') or '')
    require(node.is_file())
    seen, total = {}, 0
    try:
        with tarfile.open(archive_path, 'r:gz') as archive:
            for item in archive:
                name = safe_name(item.name)
                require(name not in seen and len(seen) < MAX_MEMBERS)
                require(item.isdir() or item.isfile() or item.issym() or item.islnk())
                require(name != '.' or item.isdir())
                require(not item.pax_headers or set(item.pax_headers) <= {'path', 'linkpath', 'mtime', 'atime', 'ctime'})
                require(not item.mode & 0o7000)
                require(item.size >= 0)
                total += item.size
                require(total <= MAX_BYTES)
                target = stage / name
                require(all(not parent.is_symlink() for parent in target.parents if parent != root.parent))
                origin = target
                if name.startswith('operations/') or name.startswith('migrations/'):
                    prefix = 'ops/vps/' if name.startswith('operations/') else 'drizzle/'
                    source = prefix + name.split('/', 1)[1]
                    origin = root / source
                    if not item.isdir():
                        require(source in tracked and not item.issym() and not item.islnk())
                elif name.startswith('node_modules/'):
                    origin = root / name
                elif name == 'bin/node':
                    origin = node
                if item.isdir():
                    require(target.is_dir() and not target.is_symlink() and origin.is_dir())
                elif item.issym():
                    require(name.startswith('node_modules/') and item.size == 0)
                    require(not PurePosixPath(item.linkname).is_absolute() and '\\' not in item.linkname)
                    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), item.linkname))
                    require(safe_name(resolved).startswith('node_modules/'))
                    require(target.is_symlink() and origin.is_symlink()
                            and os.readlink(target) == item.linkname and os.readlink(origin) == item.linkname)
                elif item.islnk():
                    linked = safe_name(item.linkname)
                    require(name.startswith('node_modules/') and linked.startswith('node_modules/')
                            and linked in seen and seen[linked].isfile() and item.size == 0)
                    require(target.is_file() and not target.is_symlink() and origin.is_file() and not origin.is_symlink())
                    with target.open('rb') as a, origin.open('rb') as b, (stage / linked).open('rb') as c:
                        require(hash_stream(a) == hash_stream(b) == hash_stream(c))
                else:
                    require(target.is_file() and not target.is_symlink() and origin.is_file() and not origin.is_symlink())
                    with archive.extractfile(item) as packed, target.open('rb') as built, origin.open('rb') as source:
                        require(hash_stream(packed, inspect=True) == hash_stream(built) == hash_stream(source))
                seen[name] = item
        require(ROOT_FILES | {'bin/node'} <= set(seen))
        for name, item in seen.items():
            require(all(str(parent) not in seen or seen[str(parent)].isdir()
                        for parent in PurePosixPath(name).parents))
            if item.issym():
                resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), item.linkname))
                # npm's .bin/esbuild points to a GNU-tar-deduplicated hardlink.
                # Every hardlink above already binds an earlier regular member.
                require(resolved in seen and (seen[resolved].isfile() or seen[resolved].islnk()))
        # Prevent omitted/uninspected files in the build directory.
        inventory = {'.'}
        for parent, dirs, files in os.walk(stage, followlinks=False):
            for part in dirs + files:
                inventory.add(str((Path(parent) / part).relative_to(stage)))
        require(inventory == set(seen))
    except (OSError, tarfile.TarError, subprocess.SubprocessError) as error:
        raise PublicRuntimeError('Public runtime package could not be verified locally.') from error
    return {'members': len(seen), 'expanded_bytes': total}
