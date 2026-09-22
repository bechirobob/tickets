"""Bound Tickets deployment storage without touching live state or customer data."""
import os
import pathlib
import re
import shutil
import time


def clean(root, now=None):
    root = pathlib.Path(root)
    now = time.time() if now is None else now
    releases = root / 'releases'
    if releases.is_symlink() or not releases.is_dir():
        raise RuntimeError('Release directory must be a real directory.')
    protected = set()
    for name in ('current', 'previous'):
        link = root / name
        if link.is_symlink():
            protected.add(link.resolve(strict=True))
        elif link.exists():
            raise RuntimeError('Release pointer must be a symlink.')
    candidates = sorted((p for p in releases.iterdir() if re.fullmatch('[a-f0-9]{40}', p.name) and p.is_dir() and not p.is_symlink()), key=lambda p: p.stat().st_mtime, reverse=True)
    protected.update(p.resolve() for p in candidates[:3])
    removed = 0
    for release in candidates:
        if release.resolve() not in protected and now - release.stat().st_mtime > 2 * 86400:
            shutil.rmtree(release)
            removed += 1
    temporary = root / 'temporary'
    if temporary.exists() and not temporary.is_symlink():
        for item in temporary.iterdir():
            if item.is_file() and not item.is_symlink() and item.name.endswith('.partial') and now - item.stat().st_mtime > 86400:
                item.unlink()
    return removed


if __name__ == '__main__':
    if os.geteuid() != 0:
        raise SystemExit('Root access is required for release retention.')
    print(f'Obsolete Tickets releases removed: {clean("/srv/becore-tickets")}')
