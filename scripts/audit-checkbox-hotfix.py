#!/usr/bin/env python3
"""Run npm audit, with one immutable, expiring caption-removal release exception.

This does not patch dependencies or suppress audit output. It tolerates only the
reviewed GHSA below, with its exact existing transitive graph, for one source tree
whose candidate is a direct child of an independently trusted control baseline. Every subsequent
release fails the exception, even if it has the same tree. A genuinely clean npm
audit remains a normal success after this temporary exception has expired.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

TRUSTED_GATE_PATH = "scripts/verify-caption-source.py"
APPROVED_AT = dt.datetime(2026, 10, 3, 8, 42, 19, tzinfo=dt.timezone.utc)
EXPIRES_AT = dt.datetime(2026, 10, 4, 8, 42, 19, tzinfo=dt.timezone.utc)
LOCK_SHA256 = "b0735c8c3b9879aa1d6089365719d7f56281d3dd1ae1244fe5ecbc5140d01caf"
BRACES_INVENTORY_SHA256 = "85807dcacfb57c287dfdb760e17f9686966d6f94505c0f10f19ea0ed9ba4bf23"
BRACES_INTEGRITY = "sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA=="
ADVISORY_URL = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm"
SEVERITIES = ("info", "low", "moderate", "high", "critical")
KNOWN_ADVISORY = {
    "source": 1240992,
    "name": "braces",
    "dependency": "braces",
    "title": "braces vulnerable to stack-exhaustion denial of service through deeply nested patterns",
    "url": ADVISORY_URL,
    "severity": "high",
    "cwe": ["CWE-674"],
    "cvss": {"score": 7.5, "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H"},
    "range": "<=3.0.3",
}
# Exact reviewed transitive graph. Every string-via edge resolves to this sole GHSA.
KNOWN_GRAPH = {
    "braces": ([KNOWN_ADVISORY], ["micromatch"], False, ["node_modules/braces"]),
    "micromatch": (["braces"], ["fast-glob"], False, ["node_modules/micromatch"]),
    "fast-glob": (["micromatch"], ["@next/eslint-plugin-next", "vite-plugin-dynamic-import"], False,
                  ["node_modules/fast-glob", "node_modules/vite-plugin-dynamic-import/node_modules/fast-glob"]),
    "@next/eslint-plugin-next": (["fast-glob"], ["eslint-config-next"], False, ["node_modules/@next/eslint-plugin-next"]),
    "eslint-config-next": (["@next/eslint-plugin-next"], [], True, ["node_modules/eslint-config-next"]),
    "vite-plugin-dynamic-import": (["fast-glob"], ["vite-plugin-commonjs"], False, ["node_modules/vite-plugin-dynamic-import"]),
    "vite-plugin-commonjs": (["vite-plugin-dynamic-import"], ["vinext"], False, ["node_modules/vite-plugin-commonjs"]),
    "vinext": (["vite-plugin-commonjs"], [], True, ["node_modules/vinext"]),
}


# npm 10 (Node 22 CI) populates resolution metadata that npm 11 can leave blank.
# These exact suggestions are breaking downgrades of application frameworks,
# not a braces patch. No suggestion is executed and no installed bytes may change.
# Each populated range is accepted ONLY with its corresponding reviewed fix;
# neither field is ignored and unknown/mixed metadata fails closed.
CI_RESOLUTION_METADATA = {
    "@next/eslint-plugin-next": (">=14.3.0-canary.0", "eslint-config-next", "14.2.35"),
    "braces": ("*", "eslint-config-next", "14.2.35"),
    "eslint-config-next": (">=14.3.0-canary.0", "eslint-config-next", "14.2.35"),
    "fast-glob": ("*", "eslint-config-next", "14.2.35"),
    "micromatch": (">=0.2.0", "eslint-config-next", "14.2.35"),
    "vinext": (">=0.0.16", "vinext", "0.0.15"),
    "vite-plugin-commonjs": ("0.5.0 - 0.5.2 || >=0.7.0", "vinext", "0.0.15"),
    "vite-plugin-dynamic-import": (">=0.2.0", "vinext", "0.0.15"),
}


class AuditRejected(ValueError):
    """A missing or mismatched gate always rejects the exception."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AuditRejected(message)


def unique_object(pairs: list) -> dict:
    result = {}
    for key, value in pairs:
        require(key not in result, "Duplicate JSON key")
        result[key] = value
    return result


def parse_json(data: bytes | str) -> object:
    try:
        return json.loads(data, object_pairs_hook=unique_object,
                          parse_constant=lambda _: (_ for _ in ()).throw(AuditRejected("Non-finite JSON number")))
    except (ValueError, UnicodeError) as exc:
        raise AuditRejected("Invalid JSON: " + str(exc)) from exc


def exact_keys(value: object, keys: set, message: str) -> None:
    require(type(value) is dict and set(value) == keys, message)


def integer(value: object) -> bool:
    return type(value) is int and value >= 0


def validate_resolution_metadata(name: str, affected_range: object, fix: object) -> None:
    if affected_range == "" and fix is False:
        return
    expected_range, expected_name, expected_version = CI_RESOLUTION_METADATA[name]
    exact_keys(fix, {"name", "version", "isSemVerMajor"}, "Unknown available-fix metadata: " + name)
    require(affected_range == expected_range and fix["name"] == expected_name
            and fix["version"] == expected_version and fix["isSemVerMajor"] is True,
            "Changed dependency range or fix suggestion: " + name)


def validate_report(raw: bytes, returncode: int) -> bool:
    """Return True only for the known exception; False for a clean normal audit."""
    require(returncode in (0, 1), "npm audit failed, was signaled, or returned an unexpected status")
    require(0 < len(raw) <= 8 * 1024 * 1024, "Missing or oversized npm audit output")
    report = parse_json(raw)
    exact_keys(report, {"auditReportVersion", "vulnerabilities", "metadata"}, "Unexpected npm audit schema or error response")
    require(type(report["auditReportVersion"]) is int and report["auditReportVersion"] == 2, "Unsupported npm audit schema")
    vulnerabilities = report["vulnerabilities"]
    require(type(vulnerabilities) is dict, "Invalid vulnerability map")
    metadata = report["metadata"]
    exact_keys(metadata, {"vulnerabilities", "dependencies"}, "Invalid npm audit metadata")
    counts = metadata["vulnerabilities"]
    exact_keys(counts, set(SEVERITIES) | {"total"}, "Invalid vulnerability counts")
    require(all(integer(count) for count in counts.values()), "Non-integer vulnerability count")
    require(counts["total"] == sum(counts[severity] for severity in SEVERITIES) == len(vulnerabilities), "Inconsistent vulnerability counts")
    dependencies = metadata["dependencies"]
    exact_keys(dependencies, {"prod", "dev", "optional", "peer", "peerOptional", "total"}, "Invalid dependency metadata")
    require(all(integer(count) for count in dependencies.values()) and dependencies["total"] > 0, "Invalid dependency counts")
    if not vulnerabilities:
        require(returncode == 0, "npm audit returned a failure with no findings")
        return False
    require(returncode == 1, "npm audit status does not match its findings")
    require(set(vulnerabilities) == set(KNOWN_GRAPH), "New or changed dependency advisory chain")
    require(counts == {"info": 0, "low": 0, "moderate": 0, "high": 8, "critical": 0, "total": 8}, "New or changed advisory severity")
    for name, (via, effects, direct, nodes) in KNOWN_GRAPH.items():
        vulnerability = vulnerabilities[name]
        exact_keys(vulnerability, {"name", "severity", "isDirect", "via", "effects", "range", "nodes", "fixAvailable"}, "Invalid vulnerability record: " + name)
        require(vulnerability["name"] == name and vulnerability["severity"] == "high", "Changed vulnerability identity: " + name)
        require(vulnerability["isDirect"] is direct, "Changed dependency status: " + name)
        validate_resolution_metadata(name, vulnerability["range"], vulnerability["fixAvailable"])
        require(vulnerability["via"] == via, "Unknown advisory or unresolved via chain: " + name)
        for field, expected in (("effects", effects), ("nodes", nodes)):
            actual = vulnerability[field]
            require(type(actual) is list and all(type(item) is str for item in actual)
                    and sorted(actual) == sorted(expected), "Changed affected " + field + ": " + name)
    return True


def git(root: Path, *args: str) -> bytes:
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
               GIT_NO_REPLACE_OBJECTS="1", GIT_NO_LAZY_FETCH="1", GIT_TERMINAL_PROMPT="0")
    result = subprocess.run(["git", "--no-replace-objects", "-C", str(root), *args],
                            capture_output=True, timeout=30, env=env)
    require(result.returncode == 0, "Git source verification failed: " + " ".join(args))
    return result.stdout


def verify_source_scope(root: Path, now: dt.datetime | None = None) -> str:
    """Bind the audit exception to the independently selected trusted source gate.

    Workflows must execute T's preflight before any candidate code. This wrapper
    also loads its verifier from T, never imports a candidate verifier or policy.
    The original policy JSON is now an inert, fully compared snapshot file.
    """
    trusted = os.environ.get("BECORE_TRUSTED_BASE")
    require(type(trusted) is str and re.fullmatch(r"[a-f0-9]{40}", trusted) is not None,
            "Missing immutable BECORE_TRUSTED_BASE")
    head = git(root, "rev-parse", "--verify", "HEAD^{commit}").decode("ascii").strip()
    expected = os.environ.get("BECORE_RELEASE_SHA")
    require(not os.environ.get("GITHUB_ACTIONS") or expected is not None, "Missing exact CI release SHA")
    require(expected is None or expected == head, "Checked out source differs from BECORE_RELEASE_SHA")
    git(root, "diff", "--quiet", "--no-ext-diff", "--")
    git(root, "diff", "--cached", "--quiet", "--no-ext-diff", "--")
    # The trust anchor comes from the workflow/operator, not a candidate file.
    gate = git(root, "show", trusted + ":" + TRUSTED_GATE_PATH)
    require(0 < len(gate) <= 128 * 1024, "Missing or oversized trusted caption verifier")
    entry = git(root, "ls-tree", "-z", trusted, "--", TRUSTED_GATE_PATH)
    blob = hashlib.sha1(b"blob " + str(len(gate)).encode() + b"\0" + gate).hexdigest().encode()
    require(entry in (mode + b" blob " + blob + b"\t" + TRUSTED_GATE_PATH.encode() + b"\0"
                     for mode in (b"100644", b"100755")), "Trusted verifier is not the exact regular Git blob")
    with tempfile.TemporaryDirectory(prefix="tickets-trusted-caption-") as temporary:
        path = Path(temporary) / "verify-caption-source.py"
        path.write_bytes(gate)
        require(path.read_bytes() == gate, "Materialized trusted verifier bytes changed")
        namespace = {"__name__": "trusted_caption_source", "__file__": str(path)}
        try:
            exec(compile(gate, str(path), "exec"), namespace)
            receipt = namespace["verify_source"](root, trusted, head, now=now)
        except (ValueError, KeyError, SyntaxError, RecursionError) as exc:
            raise AuditRejected("Trusted caption source gate rejected: " + str(exc)) from exc
        require(type(receipt) is dict and receipt.get("candidate") == head
                and receipt.get("trustedBaseline") == trusted, "Invalid trusted source receipt")
    return head


def package_inventory(package: Path) -> str:
    require(package.is_dir() and not package.is_symlink(), "Missing or symlinked installed braces package")
    records = []
    for path in sorted(package.rglob("*")):
        require(not path.is_symlink(), "Symlink in installed braces inventory")
        if path.is_dir():
            continue
        require(path.is_file(), "Non-regular installed braces entry")
        content = path.read_bytes()
        records.append([path.relative_to(package).as_posix(), len(content), hashlib.sha256(content).hexdigest()])
    return hashlib.sha256(json.dumps(records, separators=(",", ":")).encode()).hexdigest()


def verify_locked_dependencies(root: Path) -> None:
    lock_bytes = (root / "package-lock.json").read_bytes()
    require(hashlib.sha256(lock_bytes).hexdigest() == LOCK_SHA256, "Lockfile bytes changed")
    lock = parse_json(lock_bytes)
    require(type(lock) is dict and lock.get("lockfileVersion") == 3 and type(lock.get("packages")) is dict, "Invalid locked dependency data")
    braces = lock["packages"].get("node_modules/braces", {})
    require(braces.get("version") == "3.0.3" and braces.get("integrity") == BRACES_INTEGRITY, "Unapproved locked braces bytes")
    for name, (_, _, _, nodes) in KNOWN_GRAPH.items():
        for node in nodes:
            installed = parse_json((root / node / "package.json").read_bytes())
            require(type(installed) is dict and installed.get("name") == name
                    and installed.get("version") == lock["packages"].get(node, {}).get("version"), "Installed package differs from lockfile: " + node)
    require(package_inventory(root / "node_modules/braces") == BRACES_INVENTORY_SHA256, "Installed braces bytes changed; no patch is authorized")


def main() -> int:
    try:
        require(len(sys.argv) == 1, "This one-release audit gate accepts no override arguments")
        root = Path(__file__).resolve().parent.parent
        result = subprocess.run(["npm", "audit", "--json", "--audit-level=moderate"], cwd=root,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        sys.stdout.buffer.write(result.stdout)
        sys.stderr.buffer.write(result.stderr)
        require(not re.search(rb"npm\s+(?:error\b|ERR!)", result.stderr), "npm reported an operational error")
        if not validate_report(result.stdout, result.returncode):
            print("npm audit passed without an exception.")
            return 0
        head = verify_source_scope(root)
        verify_locked_dependencies(root)
        print(f"TEMPORARY EXCEPTION: {ADVISORY_URL}; unchanged braces 3.0.3; exact source {head}; expires {EXPIRES_AT.isoformat()}. The existing denial-of-service risk remains; all other gates stay required.")
        return 0
    except (AuditRejected, OSError, UnicodeError, subprocess.SubprocessError) as exc:
        print("Dependency audit rejected: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
