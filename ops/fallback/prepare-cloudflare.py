"""Provision only the fallback hostname and a DISABLED redirect. No app routing change."""
import json
import os
from monitor import api, request, RULE_REF, EXPRESSION, ACTION

token = os.environ['CLOUDFLARE_API_TOKEN']
zones = api('/zones?name=becoreops.com', token)
if len(zones) != 1:
    raise RuntimeError('Could not uniquely resolve the production zone.')
zone = zones[0]['id']
base = f'/zones/{zone}'
name = 'tickets-status.becoreops.com'
records = api(base + '/dns_records?name=' + name, token)
if records:
    if len(records) != 1 or records[0]['type'] != 'A' or records[0]['content'] != '51.195.20.137' or records[0]['proxied']:
        raise RuntimeError('Fallback DNS already exists with a different target; no record overwritten.')
else:
    api(base + '/dns_records', token, 'POST', {'type': 'A', 'name': name, 'content': '51.195.20.137', 'proxied': False, 'ttl': 300, 'comment': 'BeCore Tickets static outage page on Hermes.'})
print('Fallback DNS points to Hermes; production hostname unchanged.')
path = base + '/rulesets/phases/http_request_dynamic_redirect/entrypoint'
status, _, body = request('https://api.cloudflare.com/client/v4' + path, {'Authorization': 'Bearer ' + token})
value = json.loads(body)
definition = {'ref': RULE_REF, 'description': 'BeCore Tickets VPS maintenance fallback', 'action': 'redirect', 'expression': EXPRESSION, 'action_parameters': ACTION, 'enabled': False}
if status == 404 and any(e.get('code') == 10003 for e in value.get('errors', [])):
    ruleset = api(base + '/rulesets', token, 'POST', {'name': 'Zone redirects', 'kind': 'zone', 'phase': 'http_request_dynamic_redirect', 'rules': [definition]})
elif status == 200 and value.get('success'):
    ruleset = value['result']
    matches = [r for r in ruleset.get('rules', []) if r.get('ref') == RULE_REF]
    if not matches:
        api(base + '/rulesets/' + ruleset['id'] + '/rules', token, 'POST', definition)
        ruleset = api(base + '/rulesets/' + ruleset['id'], token)
else:
    raise RuntimeError(f'Redirect access unavailable (HTTP {status}); production routing unchanged.')
matches = [r for r in ruleset['rules'] if r.get('ref') == RULE_REF]
if len(matches) != 1:
    raise RuntimeError('Managed fallback rule could not be uniquely verified.')
rule = matches[0]
if rule['expression'] != EXPRESSION or rule['action_parameters'] != ACTION or rule['action'] != 'redirect':
    raise RuntimeError('Existing fallback rule differs; no rule overwritten.')
report = {'zoneId': zone, 'rulesetId': ruleset['id'], 'ruleId': rule['id'], 'enabled': rule.get('enabled', True), 'fallback': 'https://' + name}
print(json.dumps(report, indent=2))
