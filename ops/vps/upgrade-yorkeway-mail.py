"""Exact welcome-only successor to the retained, byte-pinned Room mail operator.

The transport loads the historical modules after validating their hashes. This
adapter changes only reviewed revision/source identities; queue fences, mounts,
credential checks, failure handling and rollback remain the existing operator's.
"""
import hashlib
import json
import re
import sys
import metadata
import upgrade

EXPECTED_APP = '3ba45d0831d130949d7d0cd50e3abbcc4432f8cd'
OLD_REV = 'ddf24949e2a42c2f00ca0502a75cdc52a4352324'
OLD_SOURCE = '37ed2a28acda640f73af4e2db90b5cb9f41b434a016a5b85c978ae579d413fc3'
NEW_SOURCE = 'acabd6ce85a04cdb59de4d93f2d248749e4af566e558cb39dc97d5307b1bb455'
# Observed by read-only run40521447160/job122249334386 at2026-10-27T14:28:46Z.
OLD_IMAGE = 'sha256:12aad856a5c51edbac448862e2a5b13ae0015eae8457e24e49ec2140fea0254b'


def configure():
    if not isinstance(OLD_IMAGE, str) or not re.fullmatch(r'sha256:[a-f0-9]{64}', OLD_IMAGE):
        raise ValueError('Installed mail image evidence is required')
    metadata.EXPECTED_APP = EXPECTED_APP
    upgrade.OLD_REV = OLD_REV
    upgrade.OLD_IMAGE = OLD_IMAGE
    upgrade.OLD_SOURCE = OLD_SOURCE
    upgrade.NEW_SOURCE = NEW_SOURCE


def main():
    configure()
    if len(sys.argv) != 3 or sys.argv[1] not in ('--preflight', '--approved-mail-upgrade'):
        raise ValueError('Explicit reviewed operator invocation required')
    source = sys.stdin.buffer.read(262145)
    if hashlib.sha256(source).hexdigest() != NEW_SOURCE:
        raise ValueError('Welcome mail source differs')
    # Exact source hash proves the sole added accepted kind; no dynamic allowlist.
    operation = upgrade.Upgrade(sys.argv[2], source)
    if sys.argv[1] == '--preflight':
        print(json.dumps(operation.preflight(), sort_keys=True))
    else:
        operation.run()
        print(json.dumps({'ok': True, 'mail_only_upgrade': True, 'test_messages_sent': 0}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps(upgrade.failure_report(error, len(sys.argv)>1 and sys.argv[1]=='--preflight'), sort_keys=True), file=sys.stderr)
        sys.exit(1)
