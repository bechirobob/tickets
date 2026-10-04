#!/usr/bin/env python3
"""Run the ordinary audit or the separately approved, one-release audit exception.

Run this trusted-baseline file from the candidate checkout, with the immutable
BECORE_TRUSTED_BASE and BECORE_RELEASE_SHA supplied independently by the workflow.
Only a genuinely clean audit bypasses the exact-source/time/dependency exception.
The old caption wrapper supplies strict validators, never its old exception.
Preinstall audits private manifest copies with isolated npm configuration.
Postinstall reuses that report, authenticating its independently retained digest
and checking installed bytes without another registry request. Raw output stays
in BECORE_AUDIT_DIRECTORY under RUNNER_TEMP; logs show only status and digests. Host activation is
responsible for the separate one-successful-release latch and private retention.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

SCRIPT_PATH = "scripts/audit-release-dependencies.py"
GATE_PATH = "scripts/verify-audit-release-source.py"
VALIDATORS_PATH = "scripts/audit-checkbox-hotfix.py"
SHA = re.compile(r"[a-f0-9]{40}\Z")
LOCK_BLOB = "759d34af76287e214f03def74be98ddefb33780a"


class AuditRejected(ValueError):
    """Missing or mismatched inputs cannot authorize the exception."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AuditRejected(message)


def git(root: Path, *args: str) -> bytes:
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
               GIT_NO_REPLACE_OBJECTS="1", GIT_NO_LAZY_FETCH="1", GIT_TERMINAL_PROMPT="0")
    result = subprocess.run(["git", "--no-replace-objects", "-C", str(root), *args],
                            capture_output=True, timeout=60, env=env)
    require(result.returncode == 0, "Git trust verification failed")
    return result.stdout


def trusted_blob(root: Path, trusted: str, path: str) -> bytes:
    require(type(trusted) is str and SHA.fullmatch(trusted) is not None,
            "Missing immutable trusted baseline")
    require(git(root, "cat-file", "-t", trusted).strip() == b"commit", "Trusted baseline must be a commit")
    entry = git(root, "ls-tree", "-z", trusted, "--", path)
    match = re.fullmatch(rb"(100644|100755) blob ([a-f0-9]{40})\t" + re.escape(path.encode()) + rb"\x00", entry)
    require(match is not None, "Trusted code must be one exact regular Git blob")
    raw = git(root, "cat-file", "blob", match[2].decode())
    require(0 < len(raw) <= 128 * 1024, "Missing or oversized trusted code")
    digest = hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
    require(digest == match[2].decode(), "Trusted code blob identity changed")
    return raw


def execute_trusted(root: Path, trusted: str, path: str, operation):
    """Load only independently selected T bytes, outside the candidate checkout."""
    raw = trusted_blob(root, trusted, path)
    with tempfile.TemporaryDirectory(prefix="tickets-trusted-audit-") as temporary:
        destination = Path(temporary) / Path(path).name
        destination.write_bytes(raw)
        require(destination.read_bytes() == raw, "Trusted materialized code changed")
        namespace = {"__name__": "trusted_audit_module", "__file__": str(destination)}
        exec(compile(raw, str(destination), "exec"), namespace)
        return operation(namespace)


def verify_checkout(root: Path, trusted: str, candidate: str) -> None:
    require(type(candidate) is str and SHA.fullmatch(candidate) is not None,
            "Missing immutable release SHA")
    require(trusted != candidate, "Candidate cannot be its own trust anchor")
    require(Path(__file__).read_bytes() == trusted_blob(root, trusted, SCRIPT_PATH),
            "Executing audit wrapper differs from the trusted baseline")
    require(git(root, "rev-parse", "HEAD").decode().strip() == candidate,
            "Checkout differs from exact release SHA")
    git(root, "merge-base", "--is-ancestor", trusted, candidate)
    git(root, "diff", "--exit-code", "--no-ext-diff", "HEAD", "--")
    git(root, "diff", "--cached", "--exit-code", "--no-ext-diff", "HEAD", "--")
    require(not git(root, "ls-files", "--others", "--exclude-standard"), "Untracked source files present")


def verify_source_scope(root: Path, trusted: str, candidate: str,
                        now: dt.datetime | None = None) -> dict:
    receipt = execute_trusted(root, trusted, GATE_PATH,
        lambda gate: gate["verify_source"](root, trusted, candidate, now=now))
    require(type(receipt) is dict and receipt.get("candidate") == candidate
            and receipt.get("trustedBaseline") == trusted, "Invalid trusted source receipt")
    return receipt


def evaluate(root: Path, trusted: str, candidate: str, raw: bytes, returncode: int,
             stderr: bytes, now: dt.datetime | None, *, installed: bool) -> str:
    require(not re.search(rb"npm\s+(?:error\b|ERR!)", stderr), "npm reported an operational error")

    def validate(validators):
        if not validators["validate_report"](raw, returncode):
            return "clean"
        verify_source_scope(root, trusted, candidate, now)
        lock = (root / "package-lock.json").read_bytes()
        require(hashlib.sha1(b"blob " + str(len(lock)).encode() + b"\0" + lock).hexdigest() == LOCK_BLOB,
                "Official package-lock blob changed")
        if installed:
            validators["verify_locked_dependencies"](root)
        return "known-advisory-exception"

    return execute_trusted(root, trusted, VALIDATORS_PATH, validate)


def evaluate_report(root: Path, trusted: str, candidate: str, raw: bytes, returncode: int,
                    stderr: bytes = b"", now: dt.datetime | None = None) -> str:
    """Final validation, including installed bytes; also used by the operator."""
    return evaluate(root, trusted, candidate, raw, returncode, stderr, now, installed=True)


def parse_json(raw: bytes):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "Duplicate JSON key")
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique,
                      parse_constant=lambda _: (_ for _ in ()).throw(AuditRejected("Invalid JSON number")))


def manifests(root: Path) -> dict[str, bytes]:
    require(not os.path.lexists(root / "npm-shrinkwrap.json"),
            "npm-shrinkwrap.json would override the audited package lock")
    result = {}
    for name in ("package.json", "package-lock.json"):
        path = root / name
        require(stat.S_ISREG(path.lstat().st_mode), "Package manifests must be regular files")
        result[name] = path.read_bytes()
        require(0 < len(result[name]) <= 8 * 1024 * 1024, "Missing or oversized package manifest")
    package, lock = (parse_json(result[name]) for name in ("package.json", "package-lock.json"))
    require(type(package) is dict and type(lock) is dict and lock.get("lockfileVersion") == 3
            and type(lock.get("packages")) is dict, "Unsupported package manifests")
    # This repository has no workspaces or local links. Reject rather than letting
    # npm's workspace filtering omit an unreviewed part of the dependency tree.
    require("workspaces" not in package
            and all(type(item) is dict and not item.get("link") for item in lock["packages"].values())
            and "workspaces" not in lock["packages"].get("", {}),
            "Workspace and linked dependency manifests are unsupported")
    return result


def manifest_hashes(inputs: dict[str, bytes]) -> dict[str, str]:
    return {"packageSha256": hashlib.sha256(inputs["package.json"]).hexdigest(),
            "lockSha256": hashlib.sha256(inputs["package-lock.json"]).hexdigest()}


def private_directory(*, create: bool = True) -> Path:
    runner = os.environ.get("RUNNER_TEMP")
    destination = os.environ.get("BECORE_AUDIT_DIRECTORY")
    require(bool(runner) and bool(destination), "Explicit private audit directory is required")
    runner_path, path = Path(runner), Path(destination)
    require(runner_path.is_absolute() and path.is_absolute(), "Audit paths must be absolute")
    runner_path = runner_path.resolve(strict=True)
    require(runner_path.is_dir(), "RUNNER_TEMP must exist")
    require(path == path.resolve() and runner_path in path.parents and path != runner_path,
            "Audit output must be a canonical path under RUNNER_TEMP")
    if create:
        require(path.parent.is_dir() and not path.exists() and not path.is_symlink(),
                "Audit output must be a new directory")
        path.mkdir(mode=0o700)
        path.chmod(0o700)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
            and stat.S_IMODE(info.st_mode) == 0o700, "Unsafe private audit directory")
    return path


def write_private(path: Path, raw: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        os.fchmod(output.fileno(), 0o600)
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())


def read_private(path: Path) -> bytes:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as source:
        info = os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and info.st_nlink == 1
                and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= 8 * 1024 * 1024,
                "Unsafe private audit evidence")
        content = source.read(8 * 1024 * 1024 + 1)
        require(len(content) == info.st_size, "Private audit evidence changed while reading")
        return content


def audit_command(directory: Path, inputs: dict[str, bytes]) -> tuple[list[str], Path, dict[str, str]]:
    isolated = directory / "manifests"
    isolated.mkdir(mode=0o700)
    for name, raw in inputs.items():
        write_private(isolated / name, raw)
    for name in ("npmrc-user", "npmrc-global"):
        write_private(directory / name, b"")
    # No candidate .npmrc, npm_config_*, NODE_OPTIONS, NODE_ENV, HOME, workspace,
    # prefix or omit settings cross this boundary. Only the trusted runner PATH
    # is needed to find the Node/npm installed by actions/setup-node.
    environment = {"PATH": os.environ.get("PATH", os.defpath),
                   "TMPDIR": str(directory), "CI": "true"}
    command = ["npm", "audit", "--package-lock-only", "--json", "--audit-level=moderate",
               "--ignore-scripts", "--workspaces=false", "--include=prod", "--include=dev",
               "--include=optional", "--include=peer", "--registry=https://registry.npmjs.org/",
               "--userconfig=" + str(directory / "npmrc-user"),
               "--globalconfig=" + str(directory / "npmrc-global"),
               "--cache=" + str(directory / "npm-cache")]
    return command, isolated, environment


def preinstall(directory: Path, root: Path, trusted: str, candidate: str) -> dict:
    raw, stderr, returncode = b"", b"", None
    status, phase = "rejected", "manifest-inputs"
    inputs = {}
    try:
        inputs = manifests(root)
        command, isolated, environment = audit_command(directory, inputs)
        phase = "npm-audit"
        try:
            result = subprocess.run(command, cwd=isolated, env=environment,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
            raw, stderr, returncode = result.stdout, result.stderr, result.returncode
        except subprocess.TimeoutExpired as exc:
            raw, stderr = exc.stdout or b"", exc.stderr or b""
            raise AuditRejected("npm audit timed out") from exc
        phase = "preinstall-policy"
        require(manifests(root) == inputs and manifests(isolated) == inputs,
                "Package manifests changed during audit")
        status = evaluate(root, trusted, candidate, raw, returncode, stderr, None, installed=False)
        phase = "preinstall-complete"
    except (ValueError, OSError, UnicodeError, subprocess.SubprocessError, KeyError, SyntaxError, RecursionError):
        status = "rejected"
    write_private(directory / "npm-audit.json", raw)
    write_private(directory / "npm-audit.stderr", stderr)
    receipt = {"schema": 1, "candidate": candidate, "trustedBaseline": trusted,
               "status": status, "phase": phase, "npmExitCode": returncode,
               "reportSha256": hashlib.sha256(raw).hexdigest(),
               "stderrSha256": hashlib.sha256(stderr).hexdigest(),
               "capturedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
               **(manifest_hashes(inputs) if inputs else {"packageSha256": None, "lockSha256": None})}
    encoded = (json.dumps(receipt, sort_keys=True) + "\n").encode()
    write_private(directory / "preinstall-receipt.json", encoded)
    digest = hashlib.sha256(encoded).hexdigest()
    if status != "rejected" and os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            output.write("audit_receipt_sha256=" + digest + "\n")
    return {"status": status, "phase": phase, "reportSha256": receipt["reportSha256"],
            "stderrSha256": receipt["stderrSha256"], "preinstallReceiptSha256": digest}


def postinstall(directory: Path, root: Path, trusted: str, candidate: str) -> dict:
    expected = os.environ.get("BECORE_PREINSTALL_RECEIPT_SHA256", "")
    require(re.fullmatch(r"[a-f0-9]{64}", expected) is not None,
            "Missing independently retained preinstall receipt digest")
    encoded = read_private(directory / "preinstall-receipt.json")
    require(hashlib.sha256(encoded).hexdigest() == expected, "Preinstall receipt changed")
    receipt = parse_json(encoded)
    keys = {"schema", "candidate", "trustedBaseline", "status", "phase", "npmExitCode",
            "reportSha256", "stderrSha256", "capturedAt", "packageSha256", "lockSha256"}
    require(type(receipt) is dict and set(receipt) == keys and type(receipt["schema"]) is int
            and receipt["schema"] == 1 and receipt["candidate"] == candidate
            and receipt["trustedBaseline"] == trusted and receipt["phase"] == "preinstall-complete"
            and receipt["status"] in ("clean", "known-advisory-exception")
            and type(receipt["npmExitCode"]) is int and receipt["npmExitCode"] in (0, 1),
            "Invalid preinstall receipt")
    raw, stderr = (read_private(directory / name) for name in ("npm-audit.json", "npm-audit.stderr"))
    require(receipt["reportSha256"] == hashlib.sha256(raw).hexdigest()
            and receipt["stderrSha256"] == hashlib.sha256(stderr).hexdigest(), "Private audit output changed")
    current = manifests(root)
    require(all(receipt[key] == value for key, value in manifest_hashes(current).items()),
            "Package manifests changed after audit")
    copies = directory / "manifests"
    info = copies.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
            and stat.S_IMODE(info.st_mode) == 0o700, "Unsafe private manifest directory")
    for name, expected_bytes in current.items():
        require(read_private(copies / name) == expected_bytes,
                "Private manifest copies changed")
    status = evaluate_report(root, trusted, candidate, raw, receipt["npmExitCode"], stderr)
    require(status == receipt["status"], "Audit classification changed after install")
    receipt.update(status=status, phase="complete", preinstallReceiptSha256=expected)
    write_private(directory / "receipt.json", (json.dumps(receipt, sort_keys=True) + "\n").encode())
    return {"status": status, "phase": "complete", "reportSha256": receipt["reportSha256"],
            "stderrSha256": receipt["stderrSha256"], "preinstallReceiptSha256": expected}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", choices=("preinstall", "postinstall"), required=True)
    args = parser.parse_args()
    phase = "trusted-inputs"
    try:
        root = Path.cwd().resolve()
        trusted = os.environ.get("BECORE_TRUSTED_BASE", "")
        candidate = os.environ.get("BECORE_RELEASE_SHA", "")
        verify_checkout(root, trusted, candidate)
        trusted_blob(root, trusted, VALIDATORS_PATH)
        trusted_blob(root, trusted, GATE_PATH)
        directory = private_directory(create=args.phase == "preinstall")
        phase = args.phase
        result = (preinstall if args.phase == "preinstall" else postinstall)(directory, root, trusted, candidate)
    except (ValueError, OSError, UnicodeError, subprocess.SubprocessError, KeyError, SyntaxError, RecursionError):
        result = {"status": "rejected", "phase": phase}
    print(json.dumps(result, sort_keys=True))
    return 0 if result["status"] in ("clean", "known-advisory-exception") else 1


if __name__ == "__main__":
    raise SystemExit(main())
