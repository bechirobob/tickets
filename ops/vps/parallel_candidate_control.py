#!/usr/bin/env python3
"""Authenticated, write-once collection for the parallel Candidate verifier.

The trusted operator supplies an authenticated transport instance and an already
authenticated verifier module. This module never imports or executes candidate
Python. Git objects, exact-attempt GitHub metadata and bounded private job logs
are the only inputs. A later pre-host call reuses the originally selected logs;
it never substitutes a newer attempt or downloads replacement evidence.
"""
import ctypes
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess

REPOSITORY = "bechirobob/tickets"
WORKFLOW = ".github/workflows/candidate-parallel-checks.yml"
BRANCH = "improve/release-evidence-parallel-20261013"
JOBS = {"build", "desktop-chromium", "mobile-chromium", "mobile-webkit", "verify"}
CONTROL_PATHS = (WORKFLOW, "ops/vps/candidate_build.py", "ops/vps/public_runtime_guard.py",
                 "scripts/audit-release-dependencies.py", "scripts/verify-audit-release-source.py",
                 "scripts/audit-checkbox-hotfix.py", "scripts/audit-release-manifest.json")
SCHEMA = "tickets-parallel-collection/v2"
MAX_LOG = 128 * 1024 ** 2
MAX_JSON = 8 * 1024 ** 2
MAX_WORKFLOW = 256 * 1024
SHA = re.compile(r"[a-f0-9]{40}\Z")
NUMBER = re.compile(r"[1-9][0-9]{0,19}\Z")
FILE_NAME = re.compile(r"(?:selection\.json|job-[1-9][0-9]{0,19}\.log)\Z")


class CollectionError(ValueError):
    """An unauthenticated, changed or unsafe input prevents admission."""


def require(value, message):
    if not value:
        raise CollectionError(message)


def number(value):
    require(type(value) in (str, int) and NUMBER.fullmatch(str(value)), "Exact positive bounded integer required")
    return int(value)


def full_sha(value):
    require(type(value) is str and SHA.fullmatch(value), "Immutable full lowercase Git SHA required")
    return value


def canonical(value):
    try:
        return (json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()
    except (TypeError, ValueError, UnicodeError) as error:
        raise CollectionError("Invalid JSON data") from error


def strict_json(raw):
    require(type(raw) is bytes and 0 < len(raw) <= MAX_JSON, "Missing or oversized collection JSON")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "Duplicate JSON key")
            result[key] = value
        return result
    def invalid(_):
        raise CollectionError("Invalid JSON number")
    try:
        return json.loads(raw, object_pairs_hook=unique, parse_constant=invalid)
    except (ValueError, UnicodeError, RecursionError) as error:
        raise CollectionError("Malformed collection JSON") from error


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def git(root, *args):
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
               GIT_NO_REPLACE_OBJECTS="1", GIT_NO_LAZY_FETCH="1", GIT_TERMINAL_PROMPT="0",
               GIT_GRAFT_FILE=os.devnull)
    try:
        result = subprocess.run(["git", "--no-replace-objects", "--literal-pathspecs", "-C", str(root), *args],
                                capture_output=True, env=env, timeout=60, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise CollectionError("Git source authentication could not complete") from error
    require(result.returncode == 0 and len(result.stdout) <= MAX_JSON, "Git source authentication failed")
    return result.stdout


def git_object_id(kind, raw):
    return hashlib.sha1(kind + b" " + str(len(raw)).encode() + b"\0" + raw).hexdigest()


def commit_tree(root, revision):
    raw = git(root, "cat-file", "commit", full_sha(revision))
    require(git_object_id(b"commit", raw) == revision and b"\n\n" in raw, "Commit identity differs")
    headers = raw.split(b"\n\n", 1)[0].splitlines()
    trees = [line[5:] for line in headers if line.startswith(b"tree ")]
    require(len(trees) == 1 and re.fullmatch(rb"[a-f0-9]{40}", trees[0]), "Malformed commit tree")
    tree = trees[0].decode("ascii")
    raw_tree = git(root, "cat-file", "tree", tree)
    require(git_object_id(b"tree", raw_tree) == tree, "Tree object identity differs")
    return tree


def control_blob(root, revision, path):
    raw = git(root, "ls-tree", "-z", revision, "--", path)
    match = re.fullmatch(rb"100644 blob ([a-f0-9]{40})\t" + re.escape(path.encode()) + rb"\x00", raw)
    require(match is not None, "Control must be exactly one regular 100644 Git blob: " + path)
    blob = match[1].decode("ascii")
    content = git(root, "cat-file", "blob", blob)
    require(git_object_id(b"blob", content) == blob, "Control blob identity differs")
    return blob, content


def authenticate_source(root, *, source, candidate, trusted_baseline):
    """Authenticate the complete tree relationship and every executable audit input."""
    source, candidate, baseline = map(full_sha, (source, candidate, trusted_baseline))
    require(baseline not in (source, candidate), "Source or candidate cannot select itself as trusted baseline")
    with Directory(root, private=False):
        main = git(root, "rev-parse", "--verify", "origin/main^{commit}").strip().decode("ascii")
        full_sha(main)
        for revision in (baseline, main, source, candidate):
            commit_tree(root, revision)
        for ancestor, descendant in ((baseline, main), (baseline, source), (baseline, candidate), (source, main)):
            git(root, "merge-base", "--is-ancestor", ancestor, descendant)
        tree = commit_tree(root, source)
        require(commit_tree(root, candidate) == tree, "Runtime and candidate complete Git trees differ")
        controls, workflow = {}, None
        for path in CONTROL_PATHS:
            blob, content = control_blob(root, baseline, path)
            require(control_blob(root, source, path) == (blob, content)
                    and control_blob(root, candidate, path) == (blob, content),
                    "Source controls differ from independently trusted baseline: " + path)
            controls[path] = blob
            if path == WORKFLOW:
                require(0 < len(content) <= MAX_WORKFLOW, "Workflow is missing or oversized")
                workflow = content
    identity = {"repository": REPOSITORY, "source_sha": source, "candidate_sha": candidate,
                "source_tree": tree, "trusted_baseline": baseline, "controls": controls}
    return identity, workflow


def directory_identity(info):
    return info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid


def file_identity(info):
    return (*directory_identity(info), info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


class Directory:
    """Pin every ancestor with O_NOFOLLOW and recheck links before and after I/O."""
    def __init__(self, path, *, private=True):
        supplied = Path(path)
        require(".." not in supplied.parts, "Parent traversal is not a collection path")
        self.path = supplied.absolute()
        self.private = private
        self.links = []
        self.fd = None
        try:
            flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
            current = os.open("/", flags)
            self.links.append((None, "/", current, directory_identity(os.fstat(current))))
            for name in self.path.parts[1:]:
                child = os.open(name, flags, dir_fd=current)
                self.links.append((current, name, child, directory_identity(os.fstat(child))))
                current = child
            self.fd = current
            self.check()
        except (OSError, CollectionError):
            self.close()
            raise

    def check(self):
        for parent, name, fd, expected in self.links:
            actual = os.stat(name, dir_fd=parent, follow_symlinks=False)
            opened = os.fstat(fd)
            require(stat.S_ISDIR(actual.st_mode) and directory_identity(actual) == expected
                    and directory_identity(opened) == expected, "Directory or ancestor changed")
        if self.private:
            info = os.fstat(self.fd)
            require(info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700,
                    "Collection and metadata directories must be owned private 0700 directories")

    def close(self):
        for _, _, fd, _ in reversed(self.links):
            os.close(fd)
        self.links = []
        self.fd = None

    def __enter__(self):
        return self

    def __exit__(self, kind, error, traceback):
        try:
            if kind is None:
                self.check()
        finally:
            self.close()

    def exists(self, name):
        self.check()
        try:
            os.stat(name, dir_fd=self.fd, follow_symlinks=False)
            return True
        except FileNotFoundError:
            return False

    def names(self):
        self.check()
        result = set(os.listdir(self.fd))
        self.check()
        return result

    def read(self, name, limit):
        require(FILE_NAME.fullmatch(name), "Unexpected collection file name")
        self.check()
        before = os.stat(name, dir_fd=self.fd, follow_symlinks=False)
        validate_file(before, limit)
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=self.fd)
        try:
            opened = os.fstat(fd)
            validate_file(opened, limit)
            require(file_identity(opened) == file_identity(before), "Evidence inode changed before read")
            chunks, count = [], 0
            while True:
                chunk = os.read(fd, min(1024 ** 2, limit + 1 - count))
                if not chunk:
                    break
                chunks.append(chunk)
                count += len(chunk)
                require(count <= limit, "Evidence exceeds size bound")
            after = os.fstat(fd)
            linked = os.stat(name, dir_fd=self.fd, follow_symlinks=False)
            require(count == before.st_size and file_identity(before) == file_identity(after)
                    == file_identity(linked), "Evidence changed during read")
            self.check()
            return b"".join(chunks)
        finally:
            os.close(fd)

    def write(self, name, raw):
        require(FILE_NAME.fullmatch(name) and type(raw) is bytes and 0 < len(raw) <= MAX_JSON,
                "Invalid collection metadata")
        self.check()
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                     0o600, dir_fd=self.fd)
        try:
            validate_file(os.fstat(fd), MAX_JSON, allow_empty=True)
            with os.fdopen(fd, "wb", closefd=False) as handle:
                handle.write(raw)
                handle.flush()
                os.fsync(fd)
        finally:
            os.close(fd)
        require(self.read(name, MAX_JSON) == raw, "Metadata changed while writing")


def validate_file(info, limit, *, allow_empty=False):
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and info.st_nlink == 1
            and stat.S_IMODE(info.st_mode) == 0o600 and (0 if allow_empty else 1) <= info.st_size <= limit,
            "Evidence must be owned, 0600, single-link, bounded regular file")


def authenticated_inventory(client, *, candidate, run_id, attempt):
    """Reject incomplete or mismatched API data before selecting any log endpoint."""
    repo = client.repository()
    require(type(repo) is dict and repo.get("full_name") == REPOSITORY
            and repo.get("private") is False and repo.get("visibility") == "public"
            and repo.get("fork") is False and type(repo.get("id")) is int and repo["id"] > 0,
            "Unexpected GitHub repository")
    run = client.api(f"actions/runs/{run_id}/attempts/{attempt}")
    require(type(run) is dict and type(run.get("id")) is int and run["id"] == run_id
            and type(run.get("run_attempt")) is int and run["run_attempt"] == attempt
            and run.get("head_sha") == candidate and run.get("path") == WORKFLOW
            and (run.get("event") == "workflow_dispatch" or
                 run.get("event") == "push" and run.get("head_branch") == BRANCH)
            and run.get("status") == "completed" and run.get("conclusion") == "success"
            and type(run.get("repository")) is dict and run["repository"].get("full_name") == REPOSITORY
            and type(run["repository"].get("id")) is int and run["repository"]["id"] == repo["id"]
            and type(run.get("head_repository")) is dict and run["head_repository"].get("full_name") == REPOSITORY
            and type(run["head_repository"].get("id")) is int and run["head_repository"]["id"] == repo["id"],
            "Exact candidate run identity or success differs")
    document = client.api(f"actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100")
    require(type(document) is dict and type(document.get("total_count")) is int
            and document["total_count"] == len(JOBS) and type(document.get("jobs")) is list
            and len(document["jobs"]) == len(JOBS), "Incomplete or unexpected exact-attempt job inventory")
    jobs, ids, names = document["jobs"], set(), set()
    for job in jobs:
        require(type(job) is dict, "Malformed candidate job")
        identifier = number(job.get("id"))
        require(type(job.get("id")) is int and identifier not in ids and job.get("name") in JOBS
                and job["name"] not in names and type(job.get("run_id")) is int and job["run_id"] == run_id
                and job.get("head_sha") == candidate and job.get("status") == "completed"
                and job.get("conclusion") == "success", "Candidate job identity or success differs")
        # GitHub may omit this field; the mandatory endpoint is attempt-specific.
        require("run_attempt" not in job or type(job["run_attempt"]) is int and job["run_attempt"] == attempt,
                "Candidate job belongs to another attempt")
        ids.add(identifier)
        names.add(job["name"])
    require(len(canonical(run)) <= MAX_JSON and len(canonical(jobs)) <= MAX_JSON, "Oversized API inventory")
    return run, jobs


def read_logs(directory, jobs):
    logs, records = {}, []
    for job in sorted(jobs, key=lambda value: value["id"]):
        identifier = number(job["id"])
        name = f"job-{identifier}.log"
        raw = directory.read(name, MAX_LOG)
        logs[identifier] = raw
        records.append({"job_id": identifier, "name": name, "size": len(raw), "sha256": digest(raw)})
    return logs, records


def stream_logs(client, directory, jobs):
    for job in sorted(jobs, key=lambda value: value["id"]):
        identifier = number(job["id"])
        name = f"job-{identifier}.log"
        directory.check()
        require(not directory.exists(name), "Refusing to replace selected job evidence")
        # GitHub.stream creates with O_EXCL. Its destination is rooted in our
        # already-open directory descriptor, not a remotely supplied URL or path.
        # The stream runs in this process; child gh never receives this fd path.
        destination = Path(f"/proc/self/fd/{directory.fd}") / name
        previous = os.umask(0o077)
        try:
            client.stream(f"actions/jobs/{identifier}/logs", destination, max_size=MAX_LOG)
        finally:
            os.umask(previous)
        directory.read(name, MAX_LOG)
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory.fd)
        try:
            validate_file(os.fstat(fd), MAX_LOG)
            os.fsync(fd)
        finally:
            os.close(fd)
    return read_logs(directory, jobs)


def rename_new(parent, old, new):
    """Linux atomic directory publication that cannot replace an existing selection."""
    parent.check()
    libc = ctypes.CDLL(None, use_errno=True)
    function = getattr(libc, "renameat2", None)
    require(function is not None, "Atomic no-replace collection publication is unavailable")
    function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    function.restype = ctypes.c_int
    if function(parent.fd, old.encode(), parent.fd, new.encode(), 1) != 0:
        raise CollectionError("Refusing to replace an existing or concurrently selected collection")
    os.fsync(parent.fd)
    parent.check()


def collect_or_verify(client, directory, *, root, source, candidate, trusted_baseline,
                      run_id, attempt, verifier, now=None, expected_proof=None):
    """Return verified v2 proof; existing selected evidence is immutable and reused.

    directory must be immediately beneath an existing private metadata directory.
    expected_proof can bind a later invocation to its independently captured first
    result. Errors never trigger retries, newer-attempt lookup, or replacement.
    """
    try:
        return _collect_or_verify(client, directory, root=root, source=source, candidate=candidate,
                                  trusted_baseline=trusted_baseline, run_id=run_id, attempt=attempt,
                                  verifier=verifier, now=now, expected_proof=expected_proof)
    except (OSError, UnicodeError, RecursionError) as error:
        raise CollectionError("Parallel evidence collection failed closed") from error


def _collect_or_verify(client, directory, *, root, source, candidate, trusted_baseline,
                       run_id, attempt, verifier, now, expected_proof):
    run_id, attempt = number(run_id), number(attempt)
    now = now or dt.datetime.now(dt.timezone.utc)
    identity, workflow = authenticate_source(root, source=source, candidate=candidate,
                                             trusted_baseline=trusted_baseline)
    identity.update(run_id=run_id, run_attempt=attempt)
    expected = {"repository": REPOSITORY, "source_sha": candidate, "source_tree": identity["source_tree"],
                "audit_trusted_base": trusted_baseline, "workflow_blob": identity["controls"][WORKFLOW],
                "run_id": run_id, "run_attempt": attempt, "now": now}
    directory = Path(directory)
    require(directory.name not in ("", ".", "..") and ".." not in directory.parts, "Invalid collection directory")
    with Directory(directory.parent) as parent:
        run, jobs = authenticated_inventory(client, candidate=candidate, run_id=run_id, attempt=attempt)
        verifier.verify_run_jobs(run, jobs, workflow, **expected)
        if parent.exists(directory.name):
            with Directory(directory) as selected:
                raw = selected.read("selection.json", MAX_JSON)
                stored = strict_json(raw)
                require(type(stored) is dict and raw == canonical(stored)
                        and set(stored) == {"schema", "identity", "run", "jobs", "artifact", "logs", "proof"}
                        and stored["schema"] == SCHEMA and stored["identity"] == identity,
                        "Selected collection identity changed; replacement is forbidden")
                require(canonical(stored["run"]) == canonical(run) and canonical(stored["jobs"]) == canonical(jobs),
                        "Original run or complete job inventory changed")
                logs, records = read_logs(selected, jobs)
                require(records == stored["logs"] and selected.names() == {"selection.json", *(x["name"] for x in records)},
                        "Selected log bytes, hashes or inventory changed")
                identifier = number(verifier.producer_artifact_id(run, jobs, logs, workflow, **expected))
                artifact = client.api(f"actions/artifacts/{identifier}")
                require(type(artifact) is dict and canonical(artifact) == canonical(stored["artifact"]),
                        "Originally selected immutable artifact metadata changed")
                proof = verifier.verify_evidence(run, jobs, artifact, logs, workflow, **expected)
                require(proof == stored["proof"] and (expected_proof is None or proof == expected_proof),
                        "Selected authenticated evidence proof changed")
                # Catch modifications by a transport/verifier callback before returning.
                require(selected.read("selection.json", MAX_JSON) == raw and read_logs(selected, jobs)[1] == records,
                        "Selected evidence changed during verification")
                return proof
        require(expected_proof is None, "Previously selected evidence is missing; replacement is forbidden")
        staging_name = ".parallel-pending-" + secrets.token_hex(16)
        os.mkdir(staging_name, mode=0o700, dir_fd=parent.fd)
        # Failed staging is retained privately for diagnosis. It is never selected
        # or reused; only a complete verified collection is atomically published.
        with Directory(directory.parent / staging_name) as staging:
            logs, records = stream_logs(client, staging, jobs)
            identifier = number(verifier.producer_artifact_id(run, jobs, logs, workflow, **expected))
            artifact = client.api(f"actions/artifacts/{identifier}")
            require(type(artifact) is dict and len(canonical(artifact)) <= MAX_JSON, "Malformed artifact metadata")
            proof = verifier.verify_evidence(run, jobs, artifact, logs, workflow, **expected)
            stored = {"schema": SCHEMA, "identity": identity, "run": run, "jobs": jobs,
                      "artifact": artifact, "logs": records, "proof": proof}
            staging.write("selection.json", canonical(stored))
            require(read_logs(staging, jobs)[1] == records
                    and staging.names() == {"selection.json", *(x["name"] for x in records)},
                    "Collected evidence changed before publication")
            os.fsync(staging.fd)
            staging.check()
            rename_new(parent, staging_name, directory.name)
            # Keep the same inode pinned across the rename, then validate its new
            # name and all bytes again. A swapped staging directory cannot become
            # a successful selected collection, even when its contents look valid.
            prior_parent, _, fd, pinned = staging.links[-1]
            staging.links[-1] = (prior_parent, directory.name, fd, pinned)
            staging.path = directory.absolute()
            staging.check()
            require(staging.read("selection.json", MAX_JSON) == canonical(stored)
                    and read_logs(staging, jobs)[1] == records
                    and staging.names() == {"selection.json", *(x["name"] for x in records)},
                    "Selected evidence changed during atomic publication")
        return proof
