"""One probe per systemd timer tick. No request bodies, credentials or guests logged."""
import json
import os
import pathlib
import re
import tempfile
import urllib.error
import urllib.request

PRODUCTION = 'https://tickets.becoreops.com/api/version'
FALLBACK = 'https://tickets-status.becoreops.com/healthz'
RULE_REF = 'becore_tickets_vps_maintenance'
EXPRESSION = '(http.host eq "tickets.becoreops.com" and http.request.method in {"GET" "HEAD"} and any(http.request.headers["accept"][*] contains "text/html") and not starts_with(http.request.uri.path, "/api/") and http.request.uri.path ne "/api" and not starts_with(http.request.uri.path, "/.well-known/"))'
ACTION = {'from_value': {'target_url': {'value': 'https://tickets-status.becoreops.com/'}, 'status_code': 302, 'preserve_query_string': False}}

def request(url, headers=None, method='GET', data=None):
    req = urllib.request.Request(url, headers=headers or {}, method=method, data=data)
    try:
        response = urllib.request.urlopen(req, timeout=12)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read(65537)

def classify(status, headers, body):
    if status == 429 and headers.get('server', '').lower() == 'cloudflare' and re.search(rb'\b1027\b', body):
        return 'quota'
    if status == 200 and 'application/json' in headers.get('content-type', '').lower():
        try:
            value = json.loads(body)
            if value.get('service') == 'becore-tickets' and re.fullmatch(r'[a-f0-9]{40}', value.get('revision', '')):
                return 'healthy'
        except (ValueError, TypeError, AttributeError):
            pass
    # Other errors must not switch the entire site for an unrelated failure.
    return 'unknown'

def decide(state, outcome):
    healthy = state.get('healthy', 0) + 1 if outcome == 'healthy' else 0
    state = {**state, 'healthy': min(healthy, 3)}
    if outcome == 'quota':
        return state, True
    if healthy >= 3:
        return state, False
    return state, None

def api(path, token, method='GET', data=None):
    token = token.strip()
    status, _, body = request('https://api.cloudflare.com/client/v4' + path,
        {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method,
        json.dumps(data).encode() if data is not None else None)
    value = json.loads(body)
    if status >= 400 or not value.get('success'):
        raise RuntimeError(f'Cloudflare API request failed (HTTP {status}).')
    return value['result']

def save(path, state):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as output:
            json.dump(state, output)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)

def main():
    token = os.environ['CLOUDFLARE_API_TOKEN'].strip()
    zone = os.environ['CLOUDFLARE_ZONE_ID']
    ruleset = os.environ['CLOUDFLARE_FALLBACK_RULESET_ID']
    rule_id = os.environ['CLOUDFLARE_FALLBACK_RULE_ID']
    if not all(re.fullmatch(r'[a-f0-9]{32}', value) for value in (zone, ruleset, rule_id)):
        raise RuntimeError('Fallback routing identifiers are invalid.')
    path = pathlib.Path(os.environ.get('STATE_DIRECTORY', '/var/lib/becore-tickets-fallback')) / 'state.json'
    try:
        state = json.loads(path.read_text())
    except (FileNotFoundError, ValueError):
        state = {}
    try:
        outcome = classify(*request(PRODUCTION, {'Accept': 'application/json', 'Cache-Control': 'no-cache', 'User-Agent': 'BeCore-Fallback/1.0'}))
    except (OSError, ValueError):
        outcome = 'unknown'
    state, desired = decide(state, outcome)
    save(path, state)
    if desired is None:
        print(f'Fallback check: {outcome}; routing unchanged.')
        return
    if desired:
        status, _, body = request(FALLBACK)
        if status != 200 or body.strip() != b'becore-tickets-fallback-ready':
            raise RuntimeError('Fallback host is not healthy; routing unchanged.')
    base = f'/zones/{zone}/rulesets/{ruleset}'
    current = api(base, token)
    matches = [rule for rule in current.get('rules', []) if rule['id'] == rule_id]
    if len(matches) != 1:
        raise RuntimeError('Managed fallback rule is missing; routing unchanged.')
    rule = matches[0]
    if rule.get('ref') != RULE_REF or rule.get('action') != 'redirect' or rule.get('expression') != EXPRESSION or rule.get('action_parameters') != ACTION:
        raise RuntimeError('Fallback rule changed outside this service; routing unchanged.')
    if rule.get('enabled', True) != desired:
        api(base + '/rules/' + rule_id, token, 'PATCH', {
            'ref': RULE_REF, 'action': 'redirect', 'expression': EXPRESSION,
            'description': 'BeCore Tickets VPS maintenance fallback',
            'action_parameters': ACTION, 'enabled': desired,
        })
        verified = api(base, token)
        if not any(r['id'] == rule_id and r.get('enabled', True) == desired for r in verified['rules']):
            raise RuntimeError('Fallback switch could not be verified.')
    print('Fallback ' + ('enabled after quota error.' if desired else 'disabled after three healthy checks.'))

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Provider/network errors can include URLs; log only our bounded messages.
        print(str(error) if isinstance(error, RuntimeError) else f'Fallback check failed: {type(error).__name__}.')
        raise SystemExit(1)
