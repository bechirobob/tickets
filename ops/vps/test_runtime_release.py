"""Offline regression coverage: no GitHub, secrets, deployments or external writes."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import MagicMock, Mock, patch

spec = importlib.util.spec_from_file_location("runtime_release", Path(__file__).with_name("runtime_release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SOURCE, TREE = "a" * 40, "b" * 40
RUN, ATTEMPT = 1234, 2
IDENTITY = dict(source=SOURCE, source_tree=TREE, run_id=RUN, attempt=ATTEMPT)
BOT = {"id": 41898282, "login": release.AUTHOR, "type": "Bot"}
ENV = {"GITHUB_ACTIONS": "true", "GITHUB_SERVER_URL": "https://github.com",
       "GITHUB_REPOSITORY": release.REPOSITORY, "GITHUB_EVENT_NAME": "push",
       "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": SOURCE, "GITHUB_WORKFLOW_SHA": SOURCE,
       "GITHUB_WORKFLOW_REF": f"{release.REPOSITORY}/{release.WORKFLOW}@refs/heads/main",
       "GITHUB_RUN_ID": str(RUN), "GITHUB_RUN_ATTEMPT": str(ATTEMPT)}


def fake_git(*args):
    return {("rev-parse", "HEAD"): SOURCE, ("rev-parse", "HEAD^{tree}"): TREE,
            ("diff", "--name-only", "HEAD", "--"): ""}[args]


class FakeGitHub:
    def __init__(self):
        self.repo = {"full_name": release.REPOSITORY, "private": True, "visibility": "private", "fork": False}
        self.run = {"id": RUN, "run_attempt": ATTEMPT, "head_sha": SOURCE, "path": release.WORKFLOW,
                    "head_branch": "main", "event": "push", "status": "completed", "conclusion": "success",
                    "repository": {"full_name": release.REPOSITORY},
                    "head_repository": {"full_name": release.REPOSITORY}}
        self.release = None
        self.ref = None
        self.blobs = {}
        self.calls = []
        self.denied = False
        self.fail_upload = False
        self.corrupt_download = None
        self.change_after_download = False
        self.downloaded = 0
        self.log = b""
        self.jobs = [{"id": 301, "name": "verify", "run_id": RUN, "run_attempt": ATTEMPT,
                      "head_sha": SOURCE, "status": "completed", "conclusion": "success",
                      "steps": [{"name": release.PUBLISH_STEP, "status": "completed", "conclusion": "success"}]},
                     {"id": 302, "name": "handoff", "run_id": RUN, "head_sha": SOURCE,
                      "status": "completed", "conclusion": "success"}]

    def repository(self):
        self.calls.append(("repository",))
        if self.denied:
            raise release.ApiError("Denied", 403)
        return copy.deepcopy(self.repo)

    def api(self, suffix, *, method="GET", payload=None):
        self.calls.append((method, suffix, copy.deepcopy(payload)))
        if self.denied:
            raise release.ApiError("Denied", 403)
        if method == "POST" and suffix == "releases":
            assert self.release is None
            assert payload["make_latest"] == "false"
            self.release = dict(payload, id=101, author=BOT.copy(), assets=[], published_at=None)
            del self.release["make_latest"]
            return copy.deepcopy(self.release)
        if method == "PATCH" and suffix == "releases/101":
            assert payload == {"draft": False, "prerelease": True, "make_latest": "false"}
            self.release.update(draft=False, published_at="2026-10-02T14:00:00Z")
            self.ref = {"ref": "refs/tags/" + self.release["tag_name"],
                        "object": {"type": "commit", "sha": SOURCE}}
            return copy.deepcopy(self.release)
        assert method == "GET", (method, suffix)
        if suffix.startswith("releases?per_page=100&page="):
            return [] if self.release is None else [copy.deepcopy(self.release)]
        if suffix == f"actions/runs/{RUN}/attempts/{ATTEMPT}/jobs?per_page=100":
            return {"total_count": len(self.jobs), "jobs": copy.deepcopy(self.jobs)}
        if suffix == f"actions/runs/{RUN}/attempts/{ATTEMPT}":
            return copy.deepcopy(self.run)
        if suffix == "git/commits/" + SOURCE:
            return {"sha": SOURCE, "tree": {"sha": TREE}}
        if suffix.startswith("git/ref/tags/"):
            if self.ref is None:
                raise release.ApiError("Missing ref", 404)
            return copy.deepcopy(self.ref)
        if suffix.startswith("releases/tags/") or suffix == "releases/101":
            if self.release is None:
                raise release.ApiError("Missing release", 404)
            result = copy.deepcopy(self.release)
            if self.change_after_download and self.downloaded == 3:
                result["assets"][0]["id"] += 50
            return result
        raise AssertionError(suffix)

    def command(self, args, *, timeout=120):
        self.calls.append(("command", list(args)))
        assert args[:2] == ["release", "upload"]
        assert "--clobber" not in args and "delete" not in args
        assert args[3:5] == ["--repo", release.REPOSITORY]
        if self.fail_upload:
            raise release.ApiError("Upload uncertain", 502)
        self.install_assets([Path(path) for path in args[5:]])
        return b""

    def install_assets(self, paths):
        self.release["assets"] = []
        for index, path in enumerate(paths, 200):
            data = path.read_bytes()
            self.blobs[index] = data
            self.release["assets"].append({"id": index, "name": path.name, "size": len(data),
                "state": "uploaded", "digest": "sha256:" + hashlib.sha256(data).hexdigest(),
                "content_type": {release.ARCHIVE: "application/x-gtar", release.CHECKSUM: "text/plain; charset=utf-8",
                                 release.MANIFEST: "application/json"}[path.name], "uploader": BOT.copy(),
                "browser_download_url": "https://untrusted.invalid/danger", "url": "--evil"})

    def seed(self, directory, *, draft=False):
        manifest = release.generate_manifest(directory, **IDENTITY)
        self.release = {"id": 101, "tag_name": manifest["release_tag"], "name": manifest["release_tag"],
                        "target_commitish": SOURCE, "body": release.release_body(manifest), "draft": draft,
                        "prerelease": True, "published_at": None if draft else "2026-10-02T14:00:00Z",
                        "author": BOT.copy()}
        self.install_assets([directory / name for name in release.NAMES])
        if not draft:
            self.ref = {"ref": "refs/tags/" + manifest["release_tag"], "object": {"type": "commit", "sha": SOURCE}}
        self.log = (b"2026-10-02T14:00:00.0000000Z " + release.PRODUCER_MARKER.encode()
                    + release.canonical(release.producer_receipt(manifest, self.release)))
        return manifest

    def job_log(self, job_id):
        self.calls.append(("logs", job_id))
        assert job_id == 301
        return self.log

    def download_asset(self, asset_id, destination, expected_size):
        self.calls.append(("download", asset_id, destination.name, expected_size))
        data = self.blobs[asset_id]
        if destination.name == self.corrupt_download:
            data = b"!" + data[1:]
        with destination.open("xb") as handle:
            handle.write(data)
        self.downloaded += 1

    def mutations(self):
        return [call for call in self.calls if call[0] in ("POST", "PATCH", "command")]


class RuntimeReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.package = self.root / "package"
        self.package.mkdir()
        (self.package / release.ARCHIVE).write_bytes(b"\x1f\x8btest-runtime-archive")
        self.destination = self.root / "download"
        self.client = FakeGitHub()

    def publish(self):
        self.client.run.update(status="in_progress", conclusion=None)
        self.stdout = io.StringIO()
        with patch.dict(os.environ, ENV, clear=True), patch.object(release, "git", side_effect=fake_git), \
                patch("sys.stdout", self.stdout):
            return release.publish(self.package, self.client)

    def download(self):
        return release.download(self.destination, source=SOURCE, run_id=RUN, attempt=ATTEMPT, client=self.client)

    def test_manifest_is_deterministic_and_binds_exact_identity(self):
        first = release.generate_manifest(self.package, **IDENTITY)
        second = release.generate_manifest(self.package, **IDENTITY)
        self.assertEqual(first, second)
        self.assertEqual(first["release_tag"], f"tickets-vps-{SOURCE}-{RUN}-{ATTEMPT}")
        self.assertEqual(first["repository"], release.REPOSITORY)
        self.assertEqual(release.validate_local(self.package, **IDENTITY), first)

    def test_manifest_rejects_changed_existing_checksum(self):
        (self.package / release.CHECKSUM).write_text("wrong\n")
        with self.assertRaises(release.TransportError):
            release.generate_manifest(self.package, **IDENTITY)
        self.assertEqual((self.package / release.CHECKSUM).read_text(), "wrong\n")

    def test_symlink_archive_is_rejected(self):
        target = self.package / release.ARCHIVE
        target.rename(self.root / "archive")
        target.symlink_to(self.root / "archive")
        with self.assertRaises(release.TransportError):
            release.generate_manifest(self.package, **IDENTITY)

    def test_invalid_identifiers_are_rejected(self):
        for field, values in {"source": ["main", "A" * 40, "../release", SOURCE + "/x"],
                              "source_tree": ["head", None], "run_id": [True, 0, "01", "--help"],
                              "attempt": [0, "1/../2", -1, "1" * 21]}.items():
            for value in values:
                with self.subTest(field=field, value=value), self.assertRaises(release.TransportError):
                    release.generate_manifest(self.package, **dict(IDENTITY, **{field: value}))

    def test_publish_draft_upload_publish_sequence(self):
        manifest = self.publish()
        actions = self.client.mutations()
        self.assertEqual([value[0] for value in actions], ["POST", "command", "PATCH"])
        self.assertTrue(actions[0][2]["draft"])
        self.assertTrue(actions[0][2]["prerelease"])
        self.assertEqual(actions[0][2]["make_latest"], "false")
        self.assertFalse(self.client.release["draft"])
        self.assertEqual(manifest["source_tree"], TREE)
        self.assertNotIn("--clobber", str(actions))
        self.assertNotIn("DELETE", str(actions))

    def test_publish_rejects_non_main_non_push_or_wrong_workflow(self):
        for key, value in {"GITHUB_REF": "refs/heads/feature", "GITHUB_EVENT_NAME": "pull_request",
                           "GITHUB_REPOSITORY": "attacker/tickets", "GITHUB_SHA": "c" * 40,
                           "GITHUB_WORKFLOW_SHA": "c" * 40, "GITHUB_ACTIONS": "false",
                           "GITHUB_WORKFLOW_REF": "attacker/other@refs/heads/main",
                           "GITHUB_SERVER_URL": "https://attacker.invalid"}.items():
            with self.subTest(key=key), patch.dict(os.environ, dict(ENV, **{key: value}), clear=True), \
                    patch.object(release, "git", side_effect=fake_git), self.assertRaises(release.TransportError):
                release.publish(self.package, self.client)
        self.assertFalse(self.client.mutations())

    def test_publish_rejects_dirty_checkout(self):
        with patch.dict(os.environ, ENV, clear=True), patch.object(release, "git", side_effect=[SOURCE, "changed.py"]), \
                self.assertRaises(release.TransportError):
            release.publish(self.package, self.client)
        self.assertFalse(self.client.calls)

    def test_publish_rejects_public_or_fork_repository(self):
        for delta in ({"private": False}, {"visibility": "public"}, {"fork": True}, {"full_name": "other/tickets"}):
            self.client.repo.update(delta)
            with self.subTest(delta=delta), self.assertRaises(release.TransportError):
                self.publish()
            self.client.repo = FakeGitHub().repo
        self.assertFalse(self.client.mutations())

    def test_publish_ref_collision_never_mutates(self):
        self.client.ref = {"ref": "refs/tags/" + release.release_tag(SOURCE, RUN, ATTEMPT),
                           "object": {"type": "commit", "sha": SOURCE}}
        with self.assertRaisesRegex(release.TransportError, "already exists"):
            self.publish()
        self.assertFalse(self.client.mutations())

    def test_publish_partial_draft_fails_without_repair(self):
        self.client.seed(self.package, draft=True)
        self.client.release["assets"].pop()
        with self.assertRaisesRegex(release.TransportError, "incomplete"):
            self.publish()
        self.assertFalse(self.client.mutations())

    def test_publish_complete_identical_draft_can_resume_once(self):
        self.client.seed(self.package, draft=True)
        self.publish()
        self.assertEqual([call[0] for call in self.client.mutations()], ["PATCH"])
        self.publish()
        self.assertEqual([call[0] for call in self.client.mutations()], ["PATCH"])

    def test_publish_identical_published_release_is_read_only(self):
        self.client.seed(self.package)
        self.publish()
        self.assertFalse(self.client.mutations())

    def test_publish_collision_with_changed_asset_digest_fails(self):
        self.client.seed(self.package, draft=True)
        self.client.release["assets"][0]["digest"] = "sha256:" + "c" * 64
        with self.assertRaisesRegex(release.TransportError, "bytes differ"):
            self.publish()
        self.assertFalse(self.client.mutations())

    def test_uncertain_upload_not_retried_and_draft_not_published(self):
        self.client.fail_upload = True
        with self.assertRaises(release.ApiError):
            self.publish()
        self.assertTrue(self.client.release["draft"])
        self.assertEqual([call[0] for call in self.client.mutations()], ["POST", "command"])
        self.client.fail_upload = False
        with self.assertRaisesRegex(release.TransportError, "incomplete"):
            self.publish()
        self.assertEqual([call[0] for call in self.client.mutations()], ["POST", "command"])

    def test_denied_token_never_mutates(self):
        self.client.denied = True
        with self.assertRaises(release.ApiError):
            self.publish()
        self.assertFalse(self.client.mutations())

    def test_download_and_offline_receipt_validate_without_remote_writes(self):
        manifest = self.client.seed(self.package)
        receipt = self.download()
        self.assertEqual(receipt["manifest"], manifest)
        self.assertEqual(release.verify_local_receipt(self.destination, **IDENTITY), receipt)
        self.assertEqual(set(path.name for path in self.destination.iterdir()), set((*release.NAMES, release.RECEIPT)))
        self.assertFalse(self.client.mutations())
        self.assertTrue(all("untrusted.invalid" not in str(call) for call in self.client.calls))
        self.assertNotIn("url", receipt["release"]["assets"][0])
        self.assertEqual([call[1] for call in self.client.calls if call[0] == "GET" and call[1].endswith(f"/attempts/{ATTEMPT}")],
                         [f"actions/runs/{RUN}/attempts/{ATTEMPT}"] * 2)

    def test_download_rejects_draft_or_incomplete_release(self):
        self.client.seed(self.package, draft=True)
        with self.assertRaisesRegex(release.TransportError, "Draft"):
            self.download()
        self.client.release.update(draft=False, published_at="now")
        self.client.release["assets"].pop()
        with self.assertRaisesRegex(release.TransportError, "incomplete"):
            self.download()
        self.assertFalse(self.client.mutations())

    def test_download_rejects_wrong_run_identity_and_unsuccessful_attempt(self):
        self.client.seed(self.package)
        original = copy.deepcopy(self.client.run)
        for key, value in {"id": RUN + 1, "run_attempt": ATTEMPT + 1, "head_sha": "c" * 40,
                           "path": ".github/workflows/evil.yml", "head_branch": "feature",
                           "event": "workflow_dispatch", "status": "in_progress", "conclusion": "failure",
                           "repository": {"full_name": "other/tickets"},
                           "head_repository": {"full_name": "fork/tickets"}}.items():
            self.client.run = dict(original, **{key: value})
            with self.subTest(key=key), self.assertRaises(release.TransportError):
                self.download()
        self.assertEqual(self.client.downloaded, 0)

    def test_download_rejects_release_identity_mismatch(self):
        self.client.seed(self.package)
        original = copy.deepcopy(self.client.release)
        cases = {"id": "101", "tag_name": release.release_tag(SOURCE, RUN, 3), "name": "other",
                 "target_commitish": "c" * 40, "body": "tampered", "prerelease": False,
                 "published_at": None, "author": {"login": "attacker", "id": 99, "type": "User"}}
        for key, value in cases.items():
            self.client.release = dict(original, **{key: value})
            with self.subTest(key=key), self.assertRaises(release.TransportError):
                self.download()
        self.assertEqual(self.client.downloaded, 0)

    def test_download_rejects_tag_pointing_elsewhere(self):
        self.client.seed(self.package)
        self.client.ref["object"]["sha"] = "c" * 40
        with self.assertRaisesRegex(release.TransportError, "different commit"):
            self.download()
        self.assertEqual(self.client.downloaded, 0)

    def test_download_validates_annotated_tag_chain(self):
        self.client.seed(self.package)
        tag_sha = "d" * 40
        self.client.ref["object"] = {"type": "tag", "sha": tag_sha}
        original_api = self.client.api
        def api(suffix, **kwargs):
            if suffix == "git/tags/" + tag_sha:
                return {"sha": tag_sha, "object": {"type": "commit", "sha": SOURCE}}
            return original_api(suffix, **kwargs)
        self.client.api = api
        self.download()
        self.assertFalse(self.client.mutations())

    def test_download_accepts_github_cli_tar_gzip_content_type(self):
        self.client.seed(self.package)
        archive = next(asset for asset in self.client.release["assets"] if asset["name"] == release.ARCHIVE)
        self.assertEqual(archive["content_type"], "application/x-gtar")
        self.download()
        self.assertEqual((self.destination / release.ARCHIVE).read_bytes(),
                         (self.package / release.ARCHIVE).read_bytes())
        self.assertFalse(self.client.mutations())

    def test_gtar_content_type_does_not_bypass_archive_integrity(self):
        self.client.seed(self.package)
        self.client.corrupt_download = release.ARCHIVE
        with self.assertRaises(release.TransportError):
            self.download()
        self.assertFalse(self.client.mutations())
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_gtar_content_type_is_archive_only(self):
        manifest = self.client.seed(self.package)
        for name in (release.CHECKSUM, release.MANIFEST):
            metadata = copy.deepcopy(self.client.release)
            next(asset for asset in metadata["assets"] if asset["name"] == name)["content_type"] = "application/x-gtar"
            with self.subTest(name=name), self.assertRaises(release.TransportError):
                release.validate_release(metadata, manifest)

    def test_download_rejects_invalid_asset_metadata(self):
        self.client.seed(self.package)
        original = copy.deepcopy(self.client.release)
        cases = {"id": -1, "name": "../escape", "state": "starter", "size": 0,
                 "content_type": "text/html", "digest": None, "uploader": {"login": "evil", "id": 1, "type": "Bot"}}
        for key, value in cases.items():
            self.client.release = copy.deepcopy(original)
            self.client.release["assets"][0][key] = value
            with self.subTest(key=key), self.assertRaises(release.TransportError):
                self.download()
        self.assertEqual(self.client.downloaded, 0)

    def test_download_rejects_duplicate_asset_names_and_ids(self):
        self.client.seed(self.package)
        original = copy.deepcopy(self.client.release)
        for key in ("name", "id"):
            self.client.release = copy.deepcopy(original)
            self.client.release["assets"][1][key] = self.client.release["assets"][0][key]
            with self.subTest(key=key), self.assertRaises(release.TransportError):
                self.download()

    def test_download_rejects_tampering_in_each_asset_and_leaves_no_outputs(self):
        self.client.seed(self.package)
        for name in release.NAMES:
            self.client.corrupt_download = name
            with self.subTest(name=name), self.assertRaises(release.TransportError):
                self.download()
            self.assertEqual(list(self.destination.iterdir()), [])

    def test_download_rejects_manifest_identity_even_with_updated_metadata_digests(self):
        self.client.seed(self.package)
        manifest = json.loads((self.package / release.MANIFEST).read_bytes())
        manifest["run_attempt"] += 1
        raw = release.canonical(manifest)
        self.client.blobs[202] = raw
        self.client.release["assets"][2].update(size=len(raw), digest="sha256:" + hashlib.sha256(raw).hexdigest())
        self.client.release["body"] = release.release_body(manifest)
        with self.assertRaisesRegex(release.TransportError, "producer-job log receipt"):
            self.download()

    def test_download_refuses_metadata_changes_in_flight(self):
        self.client.seed(self.package)
        self.client.change_after_download = True
        with self.assertRaisesRegex(release.TransportError, "changed during download"):
            self.download()
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_download_refuses_nonempty_destination_without_network(self):
        self.destination.mkdir()
        (self.destination / "keep").write_text("keep")
        with self.assertRaisesRegex(release.TransportError, "empty"):
            self.download()
        self.assertFalse(self.client.calls)
        self.assertEqual((self.destination / "keep").read_text(), "keep")

    def test_download_refuses_public_repository(self):
        self.client.seed(self.package)
        self.client.repo["private"] = False
        with self.assertRaisesRegex(release.TransportError, "private"):
            self.download()
        self.assertEqual(self.client.downloaded, 0)

    def test_local_receipt_rejects_content_tampering(self):
        self.client.seed(self.package)
        self.download()
        for name in (*release.NAMES, release.RECEIPT):
            path = self.destination / name
            original = path.read_bytes()
            path.write_bytes(b"!" + original[1:])
            with self.subTest(name=name), self.assertRaises(release.TransportError):
                release.verify_local_receipt(self.destination, **IDENTITY)
            path.write_bytes(original)

    def test_local_receipt_rejects_mismatched_expected_identity(self):
        self.client.seed(self.package)
        self.download()
        for key, value in {"source": "c" * 40, "source_tree": "d" * 40, "run_id": RUN + 1, "attempt": ATTEMPT + 1}.items():
            with self.subTest(key=key), self.assertRaises(release.TransportError):
                release.verify_local_receipt(self.destination, **dict(IDENTITY, **{key: value}))

    def test_receipt_requires_valid_asset_and_release_ids(self):
        self.client.seed(self.package)
        self.download()
        path = self.destination / release.RECEIPT
        original = path.read_bytes()
        for target in ("release", "asset"):
            receipt = json.loads(original)
            if target == "release":
                receipt["release"]["id"] = None
            else:
                receipt["release"]["assets"][0]["id"] = 0
            path.write_bytes(release.canonical(receipt))
            with self.subTest(target=target), self.assertRaises(release.TransportError):
                release.verify_local_receipt(self.destination, **IDENTITY)

    def test_producer_emits_exactly_one_canonical_receipt_after_success(self):
        manifest = self.publish()
        proof = release.parse_producer_log(self.stdout.getvalue().encode())
        self.assertEqual(proof, release.producer_receipt(manifest, self.client.release))
        self.assertFalse(any(call[0] == "GET" and call[1].startswith("actions/") for call in self.client.calls))

    def test_producer_emits_no_receipt_after_uncertain_upload(self):
        self.client.fail_upload = True
        with self.assertRaises(release.ApiError):
            self.publish()
        self.assertEqual(self.stdout.getvalue(), "")

    def test_consumer_rejects_missing_duplicate_and_malformed_log_receipts(self):
        self.client.seed(self.package)
        original = self.client.log
        for raw in (b"normal output", original + original, b"echo " + original,
                    release.PRODUCER_MARKER.encode() + b"{}", original.replace(b'"run_id":1234', b'"run_id":9999')):
            self.client.log = raw
            with self.subTest(raw=raw[:30]), self.assertRaises(release.TransportError):
                self.download()
        self.assertEqual(self.client.downloaded, 0)
        self.assertFalse(self.client.mutations())

    def test_consumer_rejects_replaced_release_even_when_all_asset_hashes_match(self):
        self.client.seed(self.package)
        # Simulate a writer replacing archive, checksum, manifest, release-body hash and API hashes.
        # The successful producer job log cannot be changed with those repository mutations.
        (self.package / release.ARCHIVE).write_bytes(b"attacker replacement")
        (self.package / release.CHECKSUM).unlink()
        (self.package / release.MANIFEST).unlink()
        manifest = release.generate_manifest(self.package, **IDENTITY)
        self.client.install_assets([self.package / name for name in release.NAMES])
        self.client.release["body"] = release.release_body(manifest)
        with self.assertRaisesRegex(release.TransportError, "producer-job log receipt"):
            self.download()
        self.assertEqual(self.client.downloaded, 0)

    def test_consumer_requires_exact_successful_jobs_and_publish_step(self):
        self.client.seed(self.package)
        original = copy.deepcopy(self.client.jobs)
        mutations = [lambda jobs: jobs.pop(), lambda jobs: jobs.append(copy.deepcopy(jobs[0])),
                     lambda jobs: jobs[0].update(conclusion="failure"),
                     lambda jobs: jobs[1].update(conclusion="skipped"),
                     lambda jobs: jobs[0].update(run_id=RUN + 1),
                     lambda jobs: jobs[0].update(run_attempt=ATTEMPT + 1),
                     lambda jobs: jobs[0].update(head_sha="e" * 40),
                     lambda jobs: jobs[0].update(steps=[]),
                     lambda jobs: jobs[0]["steps"][0].update(conclusion="skipped"),
                     lambda jobs: jobs[0]["steps"].append(copy.deepcopy(jobs[0]["steps"][0]))]
        for mutation in mutations:
            self.client.jobs = copy.deepcopy(original)
            mutation(self.client.jobs)
            with self.assertRaises(release.TransportError):
                self.download()
        self.assertEqual(self.client.downloaded, 0)

    def test_local_receipt_rejects_altered_producer_proof(self):
        self.client.seed(self.package)
        self.download()
        path = self.destination / release.RECEIPT
        receipt = json.loads(path.read_bytes())
        receipt["producer_receipt"]["assets"][0]["sha256"] = "f" * 64
        path.write_bytes(release.canonical(receipt))
        with self.assertRaisesRegex(release.TransportError, "producer log receipt"):
            release.verify_local_receipt(self.destination, **IDENTITY)

    def test_duplicate_json_keys_rejected(self):
        with self.assertRaisesRegex(release.TransportError, "Duplicate"):
            release.strict_json(b'{"schema":1,"schema":2}')

    def test_missing_existing_token_fails_without_auth_creation(self):
        with patch.dict(os.environ, {}, clear=True), self.assertRaisesRegex(release.TransportError, "GH_TOKEN"):
            release.GitHub()

    def test_api_uses_fixed_host_repo_and_never_inherits_malicious_host(self):
        with patch.dict(os.environ, {"GH_TOKEN": "test-token", "GH_HOST": "evil.invalid"}, clear=True):
            client = release.GitHub()
        with patch.object(client, "command", return_value=b'{}') as command:
            client.repository()
            args = command.call_args.args[0]
            self.assertIn("github.com", args)
            self.assertEqual(args[-1], "repos/" + release.REPOSITORY)
            self.assertEqual(client.env["GH_HOST"], "github.com")
            for endpoint in ("https://evil.invalid", "../evil", "releases;evil", "--help"):
                # --help is not useful because it is always behind the fixed repo path.
                if endpoint == "--help":
                    continue
                with self.assertRaises(release.TransportError):
                    client.api(endpoint)
            with self.assertRaises(release.TransportError):
                client.api("releases/1", method="DELETE")

    def stream_client(self):
        with patch.dict(os.environ, {"GH_TOKEN": "test-token"}, clear=True):
            return release.GitHub()

    def stream_mocks(self, chunks):
        process = Mock()
        process.stdout.fileno.return_value = 17
        process.wait.return_value = 0
        process.poll.return_value = 0
        selector = MagicMock()
        selector.__enter__.return_value.select.return_value = [(None, None)]
        return process, selector

    def test_streamed_download_is_fixed_endpoint_and_bounded(self):
        client = self.stream_client()
        process, selector = self.stream_mocks([b"data", b""])
        destination = self.root / "stream"
        with patch.object(release.subprocess, "Popen", return_value=process) as command, \
                patch.object(release.selectors, "DefaultSelector", return_value=selector), \
                patch.object(release.os, "read", side_effect=[b"data", b""]):
            client.download_asset(201, destination, 4)
        self.assertEqual(destination.read_bytes(), b"data")
        self.assertEqual(command.call_args.args[0][-1], f"repos/{release.REPOSITORY}/releases/assets/201")
        self.assertNotIn("test-token", str(command.call_args.args))
        process.kill.assert_not_called()

    def test_streamed_download_kills_overlong_response_before_writing(self):
        client = self.stream_client()
        process, selector = self.stream_mocks([b"toolong"])
        process.poll.return_value = None
        destination = self.root / "stream"
        with patch.object(release.subprocess, "Popen", return_value=process), \
                patch.object(release.selectors, "DefaultSelector", return_value=selector), \
                patch.object(release.os, "read", return_value=b"toolong"), \
                self.assertRaisesRegex(release.TransportError, "size limit"):
            client.download_asset(201, destination, 4)
        process.kill.assert_called_once()
        self.assertEqual(destination.read_bytes(), b"")

    def test_streamed_download_rejects_truncated_bytes(self):
        client = self.stream_client()
        process, selector = self.stream_mocks([b"abc", b""])
        with patch.object(release.subprocess, "Popen", return_value=process), \
                patch.object(release.selectors, "DefaultSelector", return_value=selector), \
                patch.object(release.os, "read", side_effect=[b"abc", b""]), \
                self.assertRaisesRegex(release.TransportError, "size mismatch"):
            client.download_asset(201, self.root / "stream", 4)

    def test_job_log_uses_only_validated_job_id_endpoint(self):
        client = self.stream_client()
        process, selector = self.stream_mocks([b"log data", b""])
        with patch.object(release.subprocess, "Popen", return_value=process) as command, \
                patch.object(release.selectors, "DefaultSelector", return_value=selector), \
                patch.object(release.os, "read", side_effect=[b"log data", b""]):
            self.assertEqual(client.job_log(301), b"log data")
        self.assertEqual(command.call_args.args[0][-1], f"repos/{release.REPOSITORY}/actions/jobs/301/logs")
        with self.assertRaises(release.TransportError):
            client.job_log("https://evil.invalid/log")

    def test_inventory_rejects_duplicate_drafts_across_pages(self):
        tag = release.release_tag(SOURCE, RUN, ATTEMPT)
        first_page = [{"id": 101, "tag_name": tag}] + [{"id": number, "tag_name": "other"} for number in range(1, 100)]
        second_page = [{"id": 102, "tag_name": tag}]
        with patch.object(self.client, "api", side_effect=[first_page, second_page]), \
                self.assertRaisesRegex(release.TransportError, "collision"):
            release.find_release(self.client, tag)

    def test_api_denial_is_sanitized_and_not_retried(self):
        with patch.dict(os.environ, {"GH_TOKEN": "super-secret"}, clear=True):
            client = release.GitHub()
        result = subprocess.CompletedProcess([], 1, b"", b"bad super-secret (HTTP 403)")
        with patch.object(release.subprocess, "run", return_value=result) as run:
            with self.assertRaises(release.ApiError) as context:
                client.repository()
            self.assertEqual(context.exception.status, 403)
            self.assertNotIn("super-secret", str(context.exception))
            self.assertEqual(run.call_count, 1)


if __name__ == "__main__":
    unittest.main()
