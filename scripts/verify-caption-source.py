#!/usr/bin/env python3
"""Verify the one caption-release tree against an independently trusted baseline.

The caller MUST load this program and select --trusted-baseline from its trusted
control plane, never from the candidate. The manifest is read from that immutable
commit, not from the checkout. The expected tree is the reviewed snapshot with
only the exact listed control files copied from the trusted baseline. No path is
excluded from the final comparison and no candidate-controlled seal is accepted.

This is a source gate, not an npm audit waiver or a deployment authorization.
It reads Git objects only, does not execute candidate code, and does not change
the index, working tree, refs, configuration, or object database.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


SCRIPT_PATH = "scripts/verify-caption-source.py"
MANIFEST_PATH = "scripts/caption-source-manifest.json"
APPROVED_AT = dt.datetime(2026, 10, 3, 8, 42, 19, tzinfo=dt.timezone.utc)
EXPIRES_AT = dt.datetime(2026, 10, 4, 8, 42, 19, tzinfo=dt.timezone.utc)
SHA = re.compile(r"[0-9a-f]{40}\Z")
MODES = {b"040000": b"tree", b"100644": b"blob", b"100755": b"blob", b"120000": b"blob"}
REGULAR_MODES = {b"100644", b"100755"}


class SourceRejected(ValueError):
    """Any missing, ambiguous, or changed input rejects this one release."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SourceRejected(message)


def git(root: Path, *args: str, data: bytes | None = None) -> bytes:
    # Do not inherit alternate repository, replacement, object, index, or config
    # selection from a candidate job. Partial clones may not fetch missing objects.
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
               GIT_NO_REPLACE_OBJECTS="1", GIT_NO_LAZY_FETCH="1", GIT_TERMINAL_PROMPT="0")
    try:
        result = subprocess.run(["git", "--no-replace-objects", "-C", str(root), *args],
                                input=data, capture_output=True, timeout=60, env=env)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise SourceRejected("Git source verification could not complete") from exc
    require(result.returncode == 0, "Git source verification failed: " + " ".join(args))
    return result.stdout


def object_id(kind: bytes, content: bytes) -> str:
    return hashlib.sha1(kind + b" " + str(len(content)).encode() + b"\0" + content).hexdigest()


def full_sha(value: object, label: str) -> str:
    require(type(value) is str and SHA.fullmatch(value) is not None,
            label + " must be an immutable full lowercase commit SHA")
    return value


def commit_info(root: Path, revision: str) -> tuple[str, list[str]]:
    full_sha(revision, "Commit")
    raw = git(root, "cat-file", "commit", revision)
    require(object_id(b"commit", raw) == revision, "Commit object identity mismatch")
    require(b"\n\n" in raw, "Malformed commit object")
    headers = raw.split(b"\n\n", 1)[0].splitlines()
    try:
        trees = [line[5:].decode("ascii") for line in headers if line.startswith(b"tree ")]
        parents = [line[7:].decode("ascii") for line in headers if line.startswith(b"parent ")]
    except UnicodeError as exc:
        raise SourceRejected("Malformed commit topology") from exc
    require(len(trees) == 1 and all(SHA.fullmatch(value) for value in trees + parents),
            "Malformed commit topology")
    require(len(parents) == len(set(parents)), "Duplicate commit parent")
    return trees[0], parents


# Every path, including every directory, maps to its precise mode/type/object ID.
Record = tuple[bytes, bytes, str]


def tree_hash(records: dict[bytes, Record], directory: bytes = b"",
              verify_existing: bool = False) -> str:
    """Reconstruct Git's complete tree, preserving empty directories and modes."""
    children: dict[bytes, list[tuple[bytes, bytes, Record]]] = {b"": []}
    for path, record in records.items():
        parent, _, name = path.rpartition(b"/")
        if record[1] == b"tree":
            children.setdefault(path, [])
        children.setdefault(parent, []).append((name, path, record))

    def digest(current: bytes) -> str:
        entries = children.get(current, [])
        entries = sorted(entries, key=lambda item: item[0] + (b"/" if item[2][1] == b"tree" else b""))
        raw = bytearray()
        for name, path, (mode, kind, oid) in entries:
            if kind == b"tree":
                actual = digest(path)
                require(not verify_existing or actual == oid, "Incomplete or noncanonical tree object")
                oid = actual
            raw.extend(mode.lstrip(b"0") + b" " + name + b"\0" + bytes.fromhex(oid))
        return object_id(b"tree", bytes(raw))

    return digest(directory)


def tree_records(root: Path, tree: str) -> dict[bytes, Record]:
    raw = git(root, "ls-tree", "-r", "-t", "-z", "--full-tree", tree)
    require(not raw or raw.endswith(b"\0"), "Incomplete source tree listing")
    records: dict[bytes, Record] = {}
    for line in raw[:-1].split(b"\0") if raw else []:
        require(b"\t" in line, "Malformed source tree entry")
        header, path = line.split(b"\t", 1)
        fields = header.split(b" ")
        require(len(fields) == 3, "Malformed source tree header")
        mode, kind, oid_bytes = fields
        require(mode in MODES and kind == MODES[mode], "Unsupported tracked source type or mode")
        require(re.fullmatch(rb"[0-9a-f]{40}", oid_bytes) is not None, "Invalid tracked object ID")
        require(path not in records and all(part not in (b"", b".", b"..", b".git")
                                            for part in path.split(b"/")), "Invalid or duplicate tracked path")
        parent = path.rpartition(b"/")[0]
        require(not parent or parent in records and records[parent][1] == b"tree", "Missing source parent tree")
        records[path] = (mode, kind, oid_bytes.decode("ascii"))
    require(tree_hash(records, verify_existing=True) == tree, "Incomplete or noncanonical root tree")
    expected_objects = {tree: b"tree"}
    for _, kind, oid in records.values():
        require(oid not in expected_objects or expected_objects[oid] == kind, "Conflicting object types")
        expected_objects[oid] = kind
    ids = sorted(expected_objects)
    found = git(root, "cat-file", "--batch-check=%(objectname) %(objecttype)",
                data=("\n".join(ids) + "\n").encode()).splitlines()
    require(found == [oid.encode() + b" " + expected_objects[oid] for oid in ids],
            "Incomplete source object database")
    return records


def unique_object(pairs: list) -> dict:
    value = {}
    for key, item in pairs:
        require(key not in value, "Duplicate manifest key")
        value[key] = item
    return value


def read_blob(root: Path, record: Record) -> bytes:
    require(record[1] == b"blob" and record[0] in REGULAR_MODES, "Control file must be a regular tracked file")
    raw = git(root, "cat-file", "blob", record[2])
    require(object_id(b"blob", raw) == record[2], "Control blob identity mismatch")
    return raw


def load_manifest(root: Path, trusted: dict[bytes, Record]) -> dict:
    require(MANIFEST_PATH.encode() in trusted, "Trusted baseline has no caption manifest")
    raw = read_blob(root, trusted[MANIFEST_PATH.encode()])
    require(len(raw) <= 32 * 1024, "Oversized caption manifest")
    try:
        manifest = json.loads(raw, object_pairs_hook=unique_object,
                              parse_constant=lambda _: (_ for _ in ()).throw(SourceRejected("Invalid JSON number")))
    except (ValueError, UnicodeError) as exc:
        raise SourceRejected("Invalid trusted caption manifest") from exc
    require(type(manifest) is dict and set(manifest) ==
            {"schema", "snapshotCommit", "approvedAt", "expiresAt", "controlFiles"}, "Unexpected caption manifest schema")
    require(type(manifest["schema"]) is int and manifest["schema"] == 1, "Unsupported caption manifest version")
    full_sha(manifest["snapshotCommit"], "Snapshot")
    require(manifest["approvedAt"] == "2026-10-03T08:42:19Z"
            and manifest["expiresAt"] == "2026-10-04T08:42:19Z", "Changed caption-release validity window")
    paths = manifest["controlFiles"]
    require(type(paths) is list and 2 <= len(paths) <= 32
            and all(type(path) is str and re.fullmatch(r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+", path)
                    and all(part not in (".", "..", ".git") for part in path.split("/")) for path in paths),
            "Invalid exact control-file list")
    require(paths == sorted(set(paths)), "Control files must be sorted and unique")
    require(SCRIPT_PATH in paths and MANIFEST_PATH in paths, "Missing trusted gate or manifest in control-file list")
    require(all(path.encode() in trusted and trusted[path.encode()][0] in REGULAR_MODES for path in paths),
            "Missing or nonregular trusted control file")
    return manifest


def verify_source(root: Path, trusted_baseline: str, candidate: str,
                  now: dt.datetime | None = None) -> dict:
    """Check immutable Git objects. `now` is for unit tests, never a CLI input."""
    trusted_baseline = full_sha(trusted_baseline, "Trusted baseline")
    candidate = full_sha(candidate, "Candidate")
    now = now if now is not None else dt.datetime.now(dt.timezone.utc)
    require(now.tzinfo is not None and APPROVED_AT <= now < EXPIRES_AT,
            "Caption release is not yet valid or has expired")
    require(git(root, "rev-parse", "--show-object-format").strip() == b"sha1", "Unsupported Git object format")
    trusted_tree, _ = commit_info(root, trusted_baseline)
    candidate_tree, parents = commit_info(root, candidate)
    if parents != [trusted_baseline]:
        require(len(parents) == 2 and parents[0] == trusted_baseline,
                "Only a direct child of the trusted baseline or its first merge is allowed")
        child_tree, child_parents = commit_info(root, parents[1])
        require(child_parents == [trusted_baseline] and child_tree == candidate_tree,
                "Merge must preserve the exact direct-child candidate tree")
    trusted = tree_records(root, trusted_tree)
    require(SCRIPT_PATH.encode() in trusted, "Trusted baseline has no caption verifier")
    try:
        executable_bytes = Path(__file__).read_bytes()
    except OSError as exc:
        raise SourceRejected("Cannot identify executing caption verifier") from exc
    require(executable_bytes == read_blob(root, trusted[SCRIPT_PATH.encode()]),
            "Executing verifier differs from the independently trusted baseline")
    manifest = load_manifest(root, trusted)
    snapshot_tree, _ = commit_info(root, manifest["snapshotCommit"])
    expected = tree_records(root, snapshot_tree)
    for path in manifest["controlFiles"]:
        key = path.encode()
        require(key not in expected or expected[key][1] == b"blob", "Control path replaces a snapshot directory")
        parts = key.split(b"/")
        for index in range(1, len(parts)):
            directory = b"/".join(parts[:index])
            require(directory not in expected or expected[directory][1] == b"tree", "Control parent is not a directory")
            expected.setdefault(directory, (b"040000", b"tree", "0" * 40))
        expected[key] = trusted[key]
    expected_tree = tree_hash(expected)
    require(candidate_tree == expected_tree, "Candidate is not the exact reviewed snapshot plus trusted controls")
    tree_records(root, candidate_tree)  # Missing objects fail even when a tree ID matches.
    return {"candidate": candidate, "trustedBaseline": trusted_baseline,
            "snapshotCommit": manifest["snapshotCommit"], "tree": candidate_tree}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--trusted-baseline", required=True)
    parser.add_argument("--candidate", required=True)
    args = parser.parse_args()
    try:
        result = verify_source(args.repo.resolve(), args.trusted_baseline, args.candidate)
    except (SourceRejected, OSError, RecursionError) as exc:
        print("Caption source rejected: " + str(exc), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
