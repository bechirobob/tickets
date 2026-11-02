"""One-off byte-preserving packaging of the approved, fixed Actions artifact."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sys
import urllib.request
import zipfile

REPO = 'bechirobob/tickets'
RUN = 41384240306
ARTIFACT = 13114687891
SOURCE = 'd9f4ca0c8c24feab8f6db17446313938f206f9e6'
DIGEST = 'sha256:19d175abe7c102c2e84951b0c01f51dcc7edfa05215c030b3bdd07a34baa5126'
NAME = 'BeCore-Tickets-iPhone-layouts-41384240306'
SIZE = 38687329
BUDGET = 20 * 1024 * 1024
LIMIT = 24 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def metadata(output):
    # Only fixed GitHub JSON API endpoints. Artifact transfer belongs exclusively
    # to the pinned official download-artifact action, never this script.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise ValueError('Unexpected metadata redirect')
    opener = urllib.request.build_opener(NoRedirect())
    def get(suffix):
        request = urllib.request.Request('https://api.github.com/repos/' + REPO + suffix,
            headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                     'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
        with opener.open(request, timeout=30) as response:
            return json.load(response)
    run = get(f'/actions/runs/{RUN}')
    artifact = get(f'/actions/artifacts/{ARTIFACT}')
    require(run['id'] == RUN and run['head_sha'] == SOURCE and run['conclusion'] == 'success'
            and run['status'] == 'completed', 'Original run/source is not the approved successful run')
    require(artifact['id'] == ARTIFACT and artifact['name'] == NAME
            and artifact['size_in_bytes'] == SIZE and artifact['digest'] == DIGEST
            and not artifact['expired'] and artifact['workflow_run']['id'] == RUN
            and artifact['workflow_run']['head_sha'] == SOURCE, 'Original artifact metadata differs')
    Path(output).write_text(json.dumps({'repository': REPO, 'runId': RUN, 'artifactId': ARTIFACT,
        'source': SOURCE, 'artifactName': NAME, 'originalZipBytes': SIZE,
        'originalZipDigestFromGitHub': DIGEST,
        'transfer': 'Pinned official actions/download-artifact; extracted bytes hashed before and after packaging'}, indent=2) + '\n')


def safe_name(name):
    path = PurePosixPath(name)
    require(isinstance(name, str) and name and '\\' not in name and not path.is_absolute()
            and '..' not in path.parts and str(path) == name, 'Unsafe evidence path')
    return name


def package(root, output, provenance):
    root, output = Path(root), Path(output)
    require(not output.exists(), 'Output must be new')
    files = {}
    for path in sorted(root.rglob('*')):
        require(not path.is_symlink(), 'Symlink in evidence')
        if path.is_dir():
            continue
        require(path.is_file(), 'Non-regular evidence file')
        name = safe_name(path.relative_to(root).as_posix())
        files[name] = path.read_bytes()
    def read(name):
        require(name in files, 'Missing manifest: ' + name)
        return json.loads(files[name])
    screens = read('screens.json')
    parity = read('parity.json')
    comparison = read('website-comparison/comparison.json')
    require(screens['sourceCommit'] == SOURCE and screens['websiteCommit'] == SOURCE
            and screens['websiteEnvironment'] == 'candidate', 'Capture source mismatch')
    require(parity and parity == screens['parity'] and all(x['match'] is True for x in parity),
            'Parity evidence incomplete or failed')
    require(comparison['status'] == 'complete' and comparison['schemaVersion'] == 1
            and comparison['candidate']['sourceRevision'] == SOURCE, 'Comparison incomplete or wrong source')
    require(comparison['menuChecks'] and all(x['assessment']['passed'] is True for x in comparison['menuChecks']),
            'Menu checks incomplete or failed')
    referenced = [safe_name(name) for page in screens['pages'] for name in page['files']]
    require(referenced, 'No captured pages')
    require(len(comparison['screenshots']) == 6, 'Incomplete before/after comparison')
    for capture in comparison['screenshots']:
        require(capture['side'] in ('before', 'after') and capture['horizontalOverflow'] is False,
                'Invalid comparison capture')
        expected = SOURCE if capture['side'] == 'after' else comparison['baseline']['sourceRevision']
        require(capture['sourceRevision'] == expected, 'Comparison capture revision mismatch')
        referenced.append('website-comparison/' + safe_name(capture['filename']))
    require(len(referenced) == len(set(referenced)), 'Duplicate image references')
    manifests = {'screens.json', 'parity.json', 'website-comparison/comparison.json'}
    require(set(files) == manifests | set(referenced), 'Missing or unreferenced original files')
    for name in referenced:
        require(name.endswith('.png') and files[name].startswith(b'\x89PNG\r\n\x1a\n'), 'Invalid PNG: ' + name)
    groups, current, size = [], [], 0
    for name, data in files.items():
        require(len(data) <= BUDGET, 'Single file exceeds packaging budget')
        if current and size + len(data) > BUDGET:
            groups.append(current)
            current, size = [], 0
        current.append(name)
        size += len(data)
    if current:
        groups.append(current)
    require(1 <= len(groups) <= 4, 'Unexpected number of parts')
    index = dict(provenance, schemaVersion=1, partCount=len(groups),
                 files=[{'path': name, 'bytes': len(files[name]), 'sha256': sha(files[name]), 'part': i}
                        for i, group in enumerate(groups, 1) for name in group])
    output.mkdir(parents=True)
    index_data = (json.dumps(index, indent=2, sort_keys=True) + '\n').encode()
    for i, group in enumerate(groups, 1):
        directory = output / f'part-{i:02}'
        directory.mkdir()
        archive = directory / f'iphone-evidence-{i:02}.zip'
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_STORED) as target:
            target.writestr('REPACK-PROVENANCE.json', index_data)
            for name in group:
                target.writestr(name, files[name])
        require(archive.stat().st_size + len(index_data) + 256 < LIMIT - 65536,
                'Part exceeds upload size budget')
        with zipfile.ZipFile(archive) as check:
            require(set(check.namelist()) == set(group) | {'REPACK-PROVENANCE.json'}, 'Part inventory changed')
            for name in group:
                require(check.read(name) == files[name], 'Original bytes changed')
        (directory / 'REPACK-PROVENANCE.json').write_bytes(index_data)
        (directory / 'SHA256SUMS').write_text(sha(archive.read_bytes()) + '  ' + archive.name + '\n')
    (output / 'index.json').write_bytes(index_data)
    print(json.dumps({'parts': len(groups), 'files': len(files), 'pngs': len(referenced),
                      'source': SOURCE, 'indexSha256': sha(index_data)}))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as handle:
            handle.write(f'parts={len(groups)}\n')
    return index


if __name__ == '__main__':
    if sys.argv[1] == 'metadata':
        metadata(sys.argv[2])
    elif sys.argv[1] == 'package':
        package(sys.argv[2], sys.argv[3], json.loads(Path(sys.argv[4]).read_text()))
    else:
        raise ValueError('Unknown operation')
