"""Receive the private Cloudflare connection over SSH stdin, then start the timer."""
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
from monitor import api, request, FALLBACK, RULE_REF, EXPRESSION, ACTION

def activate():
    if os.geteuid() != 0:
        raise RuntimeError('Root access is required to configure the private service connection.')
    values = json.load(sys.stdin)
    expected = {'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ZONE_ID', 'CLOUDFLARE_FALLBACK_RULESET_ID', 'CLOUDFLARE_FALLBACK_RULE_ID'}
    if set(values) != expected or not all(isinstance(value, str) for value in values.values()):
        raise RuntimeError('Unexpected activation configuration.')
    values = {key: value.strip() for key, value in values.items()}
    for key, value in values.items():
        if not re.fullmatch(r'[a-zA-Z0-9_-]{20,256}' if key == 'CLOUDFLARE_API_TOKEN' else r'[a-f0-9]{32}', value):
            raise RuntimeError('Invalid activation configuration.')
    base = f"/zones/{values['CLOUDFLARE_ZONE_ID']}/rulesets/{values['CLOUDFLARE_FALLBACK_RULESET_ID']}"
    ruleset = api(base, values['CLOUDFLARE_API_TOKEN'])
    rules = [rule for rule in ruleset['rules'] if rule['id'] == values['CLOUDFLARE_FALLBACK_RULE_ID']]
    if len(rules) != 1 or rules[0].get('ref') != RULE_REF or rules[0].get('expression') != EXPRESSION or rules[0].get('action_parameters') != ACTION:
        raise RuntimeError('Managed fallback rule does not match; monitor was not activated.')
    status, _, body = request(FALLBACK)
    if status != 200 or body.strip() != b'becore-tickets-fallback-ready':
        raise RuntimeError('Fallback host is not ready; monitor was not activated.')
    path = pathlib.Path('/etc/becore-tickets-fallback.env')
    fd, name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as output:
            for key, value in sorted(values.items()):
                output.write(f'{key}={value}\n')
        os.chmod(name, 0o600)
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)
    # Enable scheduled recovery before the first check can switch traffic.
    subprocess.run(['systemctl', 'enable', '--now', 'becore-tickets-fallback.timer'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(['systemctl', 'start', 'becore-tickets-fallback.service'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(['systemctl', 'is-active', '--quiet', 'becore-tickets-fallback.timer'], check=True)
    print('One-minute fallback monitor is active; first check completed.')

if __name__ == '__main__':
    try:
        activate()
    except Exception as error:
        print(str(error) if isinstance(error, RuntimeError) else f'Fallback activation failed: {type(error).__name__}.')
        raise SystemExit(1)
