#!/usr/bin/env python3
"""Offline, observational GitHub Actions timing. Never authorizes a release."""
import argparse
from collections import defaultdict
from datetime import datetime
import json
import math
from pathlib import Path
import re
import sys

CONCLUSIONS = {'success', 'failure', 'neutral', 'cancelled', 'skipped',
               'timed_out', 'action_required', 'stale', 'startup_failure'}
LANES = ('desktop-chromium', 'mobile-webkit', 'mobile-chromium')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def positive_int(value, field):
    require(type(value) is int and value > 0, f'{field}: expected positive integer')
    return value


def timestamp(value, field):
    require(isinstance(value, str) and re.fullmatch(
        r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)', value),
        f'{field}: expected timezone-qualified ISO timestamp')
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def terminal(record, field):
    require(record.get('status') == 'completed', f'{field}: incomplete status')
    require(record.get('conclusion') in CONCLUSIONS, f'{field}: invalid conclusion')


def interval(record, field):
    start = timestamp(record.get('started_at'), f'{field}.started_at')
    end = timestamp(record.get('completed_at'), f'{field}.completed_at')
    require(start <= end, f'{field}: reversed timestamps')
    return start, end


def seconds(start, end):
    return (end - start).total_seconds()


def skipped(record, field, warnings):
    # GitHub can assign placeholder/reversed times to jobs that never ran.
    for key in ('created_at', 'started_at', 'completed_at'):
        if record.get(key) is not None:
            timestamp(record[key], f'{field}.{key}')
    warnings.append(f'{field}: skipped; timestamps excluded from timing')


def summarize(payload, run_id, attempt, run=None):
    """Accept one complete attempt-jobs response (or run-id keyed archive)."""
    positive_int(run_id, 'run_id')
    positive_int(attempt, 'attempt')
    require(isinstance(payload, dict), 'jobs payload must be an object')
    if 'jobs' not in payload:
        payload = payload.get(str(run_id))
    require(isinstance(payload, dict), 'requested run missing from jobs archive')
    jobs = payload.get('jobs')
    require(isinstance(jobs, list) and jobs, 'jobs must be a nonempty array')
    require(type(payload.get('total_count')) is int and payload['total_count'] == len(jobs),
            'incomplete jobs pagination: total_count must equal collected jobs')
    require(all(isinstance(job, dict) for job in jobs), 'job must be an object')
    warnings = []
    ids, heads, repos = set(), set(), set()
    rows, starts, ends, created = [], [], [], []
    runner_groups = defaultdict(lambda: {'job_count': 0, 'runner_seconds': 0,
                                        'modeled_ceil_job_minutes': 0})
    for job in jobs:
        jid = positive_int(job.get('id'), 'job.id')
        field = f'job {jid}'
        require(jid not in ids, f'{field}: duplicate id')
        ids.add(jid)
        require(type(job.get('run_id')) is int and job['run_id'] == run_id,
                f'{field}: wrong run_id')
        require(type(job.get('run_attempt')) is int and job['run_attempt'] == attempt,
                f'{field}: wrong or missing run_attempt')
        head = job.get('head_sha')
        require(isinstance(head, str) and re.fullmatch('[0-9a-f]{40}', head),
                f'{field}: invalid head_sha')
        heads.add(head)
        match = re.fullmatch(r'https://api.github.com/repos/([^/]+/[^/]+)/actions/runs/(\d+)',
                             job.get('run_url', ''))
        require(match is not None and int(match[2]) == run_id, f'{field}: invalid run_url')
        repos.add(match[1])
        terminal(job, field)
        name = job.get('name')
        require(isinstance(name, str) and name.strip(), f'{field}: missing name')
        labels = job.get('labels')
        require(isinstance(labels, list) and all(isinstance(x, str) and x for x in labels),
                f'{field}: invalid runner labels')
        steps = job.get('steps')
        require(isinstance(steps, list), f'{field}: missing steps')
        row = {'id': jid, 'name': name, 'conclusion': job['conclusion'],
               'runner_labels': sorted(set(labels)), 'queue_seconds': None,
               'runner_seconds': 0, 'modeled_ceil_job_minutes': 0, 'steps': [], 'lanes': {}}
        if job['conclusion'] == 'skipped':
            require(not steps, f'{field}: skipped job unexpectedly contains steps')
            skipped(job, field, warnings)
            rows.append(row)
            continue
        start, end = interval(job, field)
        creation = timestamp(job.get('created_at'), f'{field}.created_at')
        require(creation <= start, f'{field}: created after start')
        starts.append(start)
        ends.append(end)
        created.append(creation)
        duration = seconds(start, end)
        row.update(queue_seconds=seconds(creation, start), runner_seconds=duration,
                   modeled_ceil_job_minutes=math.ceil(duration / 60))
        if not labels:
            warnings.append(f'{field}: runner labels unavailable; grouped as unknown')
        group = runner_groups[tuple(row['runner_labels'])]
        group['job_count'] += 1
        group['runner_seconds'] += duration
        group['modeled_ceil_job_minutes'] += row['modeled_ceil_job_minutes']
        if not steps:
            warnings.append(f'{field}: no step metadata; lane timing unavailable')
        numbers, previous_end, lanes = set(), start, defaultdict(list)
        for step in steps:
            require(isinstance(step, dict), f'{field}: step must be an object')
            number = positive_int(step.get('number'), f'{field}.step.number')
            sf = f'{field} step {number}'
            require(number not in numbers, f'{sf}: duplicate number')
            require(not numbers or number > max(numbers), f'{sf}: unordered steps')
            numbers.add(number)
            terminal(step, sf)
            sn = step.get('name')
            require(isinstance(sn, str) and sn.strip(), f'{sf}: missing name')
            entry = {'number': number, 'name': sn, 'conclusion': step['conclusion'],
                     'seconds': 0}
            if step['conclusion'] == 'skipped':
                skipped(step, sf, warnings)
            else:
                ss, se = interval(step, sf)
                require(start <= ss <= se <= end, f'{sf}: outside job interval')
                require(ss >= previous_end, f'{sf}: overlapping/out-of-order steps')
                previous_end = se
                entry['seconds'] = seconds(ss, se)
                lane = next((lane for lane in LANES if f'({lane})' in sn or f'({lane})' in name), 'other')
                lanes[lane].append((ss, se))
            row['steps'].append(entry)
        row['lanes'] = {lane: {'summed_step_seconds': sum(seconds(s, e) for s, e in spans),
                               'elapsed_span_seconds': seconds(spans[0][0], spans[-1][1])}
                        for lane, spans in lanes.items()}
        row['unattributed_job_seconds'] = duration - sum(s['seconds'] for s in row['steps'])
        rows.append(row)
    require(len(heads) == 1 and len(repos) == 1, 'mixed repository or source SHA')
    report = {'run_id': run_id, 'run_attempt': attempt, 'head_sha': next(iter(heads)),
              'repository': next(iter(repos)), 'jobs': rows, 'warnings': warnings,
              'execution_wall_seconds': seconds(min(starts), max(ends)) if starts else 0,
              'jobs_observed_elapsed_seconds': seconds(min(created), max(ends)) if starts else 0,
              'summed_job_queue_seconds': sum(row['queue_seconds'] or 0 for row in rows),
              'runner_seconds': sum(row['runner_seconds'] for row in rows),
              'modeled_ceil_job_minutes': sum(row['modeled_ceil_job_minutes'] for row in rows),
              'runner_groups': [dict(runner_labels=list(labels), **values)
                                for labels, values in sorted(runner_groups.items())],
              'run_queue_seconds': None, 'run_elapsed_through_last_job_seconds': None,
              'run_conclusion': None,
              'non_success_jobs': [row['id'] for row in rows if row['conclusion'] != 'success']}
    if run is not None:
        require(isinstance(run, dict), 'run metadata must be an object')
        require(type(run.get('id')) is int and run['id'] == run_id and
                type(run.get('run_attempt')) is int and run['run_attempt'] == attempt,
                'run metadata identity/attempt mismatch')
        require(run.get('head_sha') == report['head_sha'], 'run metadata head mismatch')
        require(isinstance(run.get('repository'), dict) and
                run['repository'].get('full_name') == report['repository'],
                'run metadata repository mismatch')
        terminal(run, 'run')
        rc = timestamp(run.get('created_at'), 'run.created_at')
        rs = timestamp(run.get('run_started_at'), 'run.run_started_at')
        require(rc <= rs and (not starts or rs <= min(starts)), 'run timestamp ordering')
        report['run_conclusion'] = run['conclusion']
        # created_at is original-run creation, not retry enqueue time.
        if attempt == 1:
            report['run_queue_seconds'] = seconds(rc, rs)
            report['run_elapsed_through_last_job_seconds'] = seconds(rc, max(ends)) if ends else None
        else:
            warnings.append('Retry enqueue time unavailable: original created_at is not an attempt queue timestamp')
    else:
        warnings.append('No run metadata: run queue/conclusion unavailable; jobs timestamps are not full release time')
    return report


def compare(before, after):
    require(before['repository'] == after['repository'], 'comparison repository mismatch')
    old, new = before['execution_wall_seconds'], after['execution_wall_seconds']
    return {'before_run': [before['run_id'], before['run_attempt']],
            'after_run': [after['run_id'], after['run_attempt']],
            'execution_wall_seconds_delta': new - old,
            'wall_speedup': old / new if new else None,
            'wall_reduction_fraction': (old - new) / old if old else None,
            'runner_seconds_delta': after['runner_seconds'] - before['runner_seconds'],
            'modeled_ceil_job_minutes_delta': after['modeled_ceil_job_minutes'] - before['modeled_ceil_job_minutes'],
            'interpretation': 'Descriptive samples only; matched inputs and causality are not established.'}


def read_json(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f'duplicate JSON key: {key}')
            result[key] = value
        return result
    return json.loads(Path(path).read_text(), object_pairs_hook=unique)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sample', action='append', nargs=4, required=True,
                        metavar=('LABEL', 'RUN_ID', 'ATTEMPT', 'JOBS_JSON'))
    parser.add_argument('--run', action='append', nargs=2, default=[], metavar=('LABEL', 'RUN_JSON'))
    parser.add_argument('--compare', nargs=2, metavar=('BEFORE_LABEL', 'AFTER_LABEL'))
    args = parser.parse_args()
    try:
        runs = {}
        for label, path in args.run:
            require(label not in runs, 'duplicate run label')
            runs[label] = read_json(path)
        reports, identities = {}, set()
        for label, rid, attempt, path in args.sample:
            require(label not in reports, 'duplicate sample label')
            report = summarize(read_json(path), int(rid), int(attempt), runs.get(label))
            identity = (report['repository'], int(rid), int(attempt))
            require(identity not in identities, 'duplicate run/attempt sample')
            identities.add(identity)
            reports[label] = report
        require(set(runs) <= set(reports), 'run metadata label has no sample')
        output = {'schema_version': 1, 'samples': reports,
                  'measurement_note': 'Job timestamps measure occupancy, not CPU usage. Minute rounding is a model, not a bill or monetary estimate. No OS multipliers applied.',
                  'retry_note': 'Only supplied attempts are counted. Internal test retries and missing attempts are unknown.',
                  'represented_attempt_groups': []}
        grouped = defaultdict(list)
        for report in reports.values():
            grouped[(report['repository'], report['run_id'])].append(report)
        for (repo, rid), samples in grouped.items():
            output['represented_attempt_groups'].append({
                'repository': repo, 'run_id': rid,
                'attempts': sorted(s['run_attempt'] for s in samples),
                'represented_rerun_attempts': sum(s['run_attempt'] > 1 for s in samples),
                'earlier_attempts_missing': sorted(set(range(1, max(s['run_attempt'] for s in samples)))
                                                   - {s['run_attempt'] for s in samples}),
                'runner_seconds': sum(s['runner_seconds'] for s in samples),
                'modeled_ceil_job_minutes': sum(s['modeled_ceil_job_minutes'] for s in samples)})
        if args.compare:
            require(all(label in reports for label in args.compare), 'unknown comparison label')
            output['comparison'] = compare(*(reports[label] for label in args.compare))
        print(json.dumps(output, indent=2, allow_nan=False))
    except (ValueError, TypeError, KeyError, OSError) as error:
        parser.error(str(error))


if __name__ == '__main__':
    main()
