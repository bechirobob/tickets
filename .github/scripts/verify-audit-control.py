#!/usr/bin/env python3
"""Test-only materialization of the reviewed audit-release source and trusted controls.

This helper never builds, publishes, activates, or updates a Git ref. The control
commit deliberately retains the old application; complete operator/pin tests
must instead see the exact reviewed snapshot with the control commit's listed
files overlaid. An isolated Git index produces that expected tree, and a local
synthetic child proves the real trusted verifier accepts it. The control commit
itself must fail the verifier and must have a different application tree.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile


SHA = re.compile(r"[a-f0-9]{40}\Z")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--control", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not SHA.fullmatch(args.control):
        raise SystemExit("Control must be an exact full commit SHA")
    repo = args.repo.resolve()
    output = args.output.resolve()
    if output.exists() or output == repo or repo in output.parents:
        raise SystemExit("Expected-source output must be a new directory outside the checkout")
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
               GIT_NO_REPLACE_OBJECTS="1", GIT_NO_LAZY_FETCH="1", GIT_TERMINAL_PROMPT="0", GIT_OPTIONAL_LOCKS="0")

    def git(*arguments: str, data: bytes | None = None) -> bytes:
        return subprocess.run(["git", "--no-replace-objects", "-C", str(repo), *arguments],
                              input=data, check=True, capture_output=True, timeout=60, env=env).stdout

    if git("rev-parse", "HEAD").decode().strip() != args.control:
        raise SystemExit("Control checks must run against their exact checked-out commit")
    git("diff", "--exit-code", "HEAD", "--")
    original_index = git("ls-files", "--stage", "-z")
    with tempfile.TemporaryDirectory(prefix="tickets-audit-release-control-") as temporary:
        temp = Path(temporary)
        verifier = temp / "verify-audit-release-source.py"
        entry = git("ls-tree", "-z", args.control, "--", "scripts/verify-audit-release-source.py")
        match = re.fullmatch(rb"(100644|100755) blob ([a-f0-9]{40})\tscripts/verify-audit-release-source\.py\x00", entry)
        if match is None:
            raise SystemExit("Trusted verifier must be one exact regular tracked blob")
        verifier.write_bytes(git("cat-file", "blob", match[2].decode()))
        content = verifier.read_bytes()
        digest = hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()
        if digest != match[2].decode():
            raise SystemExit("Staged verifier differs from the control commit before execution")
        spec = importlib.util.spec_from_file_location("trusted_audit_release_source", verifier)
        gate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gate)
        control_tree, _ = gate.commit_info(repo, args.control)
        trusted = gate.tree_records(repo, control_tree)
        manifest = gate.load_manifest(repo, trusted)
        try:
            gate.verify_source(repo, args.control, args.control)
        except gate.SourceRejected:
            pass
        else:
            raise SystemExit("Control-plane commit was incorrectly accepted as application source")

        env["GIT_INDEX_FILE"] = str(temp / "expected.index")
        git("read-tree", manifest["snapshotCommit"])
        for path in manifest["controlFiles"]:
            mode, kind, oid = trusted[path.encode()]
            if kind != b"blob" or mode not in gate.REGULAR_MODES:
                raise SystemExit("Control overlay must contain only regular files")
            git("update-index", "--add", "--cacheinfo", mode.decode(), oid, path)
        expected_tree = git("write-tree").decode().strip()
        if expected_tree == control_tree:
            raise SystemExit("Control-plane commit must retain a different, nonreleasable application tree")
        env.update(GIT_AUTHOR_NAME="Audit release control test", GIT_AUTHOR_EMAIL="audit-release-control@example.invalid",
                   GIT_COMMITTER_NAME="Audit release control test", GIT_COMMITTER_EMAIL="audit-release-control@example.invalid",
                   GIT_AUTHOR_DATE=manifest["approvedAt"], GIT_COMMITTER_DATE=manifest["approvedAt"])
        candidate = git("commit-tree", expected_tree, "-p", args.control,
                        data=b"Test-only expected audit-release source; never publish or deploy.\n").decode().strip()
        receipt = gate.verify_source(repo, args.control, candidate)
        if receipt["tree"] != expected_tree:
            raise SystemExit("Trusted gate and isolated-index expected trees disagree")
        archive = git("archive", "--format=tar", expected_tree)
        output.mkdir(mode=0o700, parents=True)
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as contents:
            contents.extractall(output, filter="data")
        env.pop("GIT_INDEX_FILE")
        if git("ls-files", "--stage", "-z") != original_index:
            raise SystemExit("Control test changed the checkout index")
        git("diff", "--exit-code", "HEAD", "--")
        print(json.dumps({"control": args.control, "controlSourceRejected": True,
                          "expectedTree": expected_tree, "expectedSource": str(output),
                          "testOnlyCandidate": candidate}, sort_keys=True))


if __name__ == "__main__":
    main()
