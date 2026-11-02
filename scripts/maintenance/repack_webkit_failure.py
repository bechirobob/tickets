"""Fixed-run read-only extraction of original WebKit failure evidence."""
import hashlib
import json
import os
from pathlib import Path
import sys
import zipfile
import repack_iphone_evidence as original

RUN = 41438362201
ARTIFACT = 13141215982
SOURCE = '32b5956549cb3eff04e2abbcfda177bccb07b0f8'
DIGEST = 'sha256:ea33463aa88dc2f9da65c2f7870e29cb584ab0ea69e62966a67413adf5739542'
NAME = 'production-browser-audit-41438362201-mobile-webkit'
SIZE = 81145778
TARGET = 'host-brand-identity-the-po-3153a--contained-on-a-320px-phone-mobile-webkit'
BUDGET = 20 * 1024 * 1024
LIMIT = 24 * 1024 * 1024
require = original.require
sha = original.sha


def metadata(output):
    # Same fixed GitHub JSON transport and official artifact download as before.
    import urllib.request
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise ValueError('Unexpected metadata redirect')
    opener = urllib.request.build_opener(NoRedirect())
    def get(suffix):
        request = urllib.request.Request('https://api.github.com/repos/bechirobob/tickets' + suffix,
            headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json'})
        with opener.open(request, timeout=30) as response:
            return json.load(response)
    run = get(f'/actions/runs/{RUN}')
    artifact = get(f'/actions/artifacts/{ARTIFACT}')
    require(run['id'] == RUN and run['head_sha'] == SOURCE and run['status'] == 'completed'
            and run['conclusion'] == 'failure', 'Original failed run/source differs')
    require(artifact['id'] == ARTIFACT and artifact['name'] == NAME and artifact['size_in_bytes'] == SIZE
            and artifact['digest'] == DIGEST and not artifact['expired']
            and artifact['workflow_run']['id'] == RUN and artifact['workflow_run']['head_sha'] == SOURCE,
            'Original artifact metadata differs')
    Path(output).write_text(json.dumps({'repository': 'bechirobob/tickets', 'runId': RUN,
        'artifactId': ARTIFACT, 'source': SOURCE, 'originalZipBytes': SIZE,
        'originalZipDigestFromGitHub': DIGEST, 'originalConclusion': 'failure',
        'selection': TARGET, 'transfer': 'Pinned official actions/download-artifact'}, indent=2) + '\n')


def package(root, output, provenance):
    root, output = Path(root), Path(output)
    require(not output.exists(), 'Output must be new')
    inventory, selected = [], []
    for path in sorted(root.rglob('*')):
        require(not path.is_symlink(), 'Symlink in evidence')
        if path.is_dir():
            continue
        require(path.is_file(), 'Non-regular evidence')
        name = original.safe_name(path.relative_to(root).as_posix())
        require(len(inventory) < 10000, 'Inventory too large')
        with path.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        item = {'path': name, 'bytes': path.stat().st_size, 'sha256': digest, 'exported': TARGET in Path(name).parts}
        inventory.append(item)
        if item['exported']:
            selected.append((path, item))
    require(selected, 'Exact failure directory missing')
    require({'trace.zip', 'test-failed-1.png', 'error-context.md'} <= {p.name for p, _ in selected},
            'Required original failure evidence missing')
    chunks = []
    for path, item in selected:
        item['chunks'] = []
        with path.open('rb') as stream:
            offset = 0
            while data := stream.read(BUDGET):
                entry = {'part': len(chunks)+1, 'member': 'original-bytes.bin', 'offset': offset,
                         'bytes': len(data), 'sha256': sha(data)}
                item['chunks'].append(entry)
                chunks.append(data)
                offset += len(data)
    require(1 <= len(chunks) <= 8, 'Failure evidence exceeds eight bounded parts')
    index = dict(provenance, schemaVersion=1, partCount=len(chunks), files=inventory,
                 reconstruction='Concatenate each exported file chunks in offset order, then verify original bytes and SHA256; no re-encoding.')
    index_data = (json.dumps(index, indent=2, sort_keys=True)+'\n').encode()
    require(len(index_data) < 1024*1024, 'Index too large')
    output.mkdir(parents=True)
    for i, data in enumerate(chunks, 1):
        directory = output/f'part-{i:02}';directory.mkdir()
        archive = directory/f'failure-evidence-{i:02}.zip'
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_STORED) as target:
            target.writestr('REPACK-PROVENANCE.json', index_data)
            target.writestr('original-bytes.bin', data)
        with zipfile.ZipFile(archive) as check:
            require(check.read('original-bytes.bin') == data, 'Original chunk bytes changed')
        require(archive.stat().st_size + len(index_data) + 65536 < LIMIT, 'Part exceeds size limit')
        (directory/'REPACK-PROVENANCE.json').write_bytes(index_data)
        (directory/'SHA256SUMS').write_text(sha(archive.read_bytes())+'  '+archive.name+'\n')
    (output/'index.json').write_bytes(index_data)
    print(json.dumps({'parts':len(chunks),'originalFiles':len(inventory),'exportedFiles':len(selected),
                      'source':SOURCE,'indexSha256':sha(index_data)}))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'],'a') as f:f.write(f'parts={len(chunks)}\n')
    return index


if __name__ == '__main__':
    if sys.argv[1] == 'metadata':metadata(sys.argv[2])
    elif sys.argv[1] == 'package':package(sys.argv[2],sys.argv[3],json.loads(Path(sys.argv[4]).read_text()))
    else:raise ValueError('Unknown operation')
