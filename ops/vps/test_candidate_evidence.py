"""Offline evidence transport and Candidate workflow gates; no network or providers."""
import base64
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import random
import re
import struct
import tempfile
import unittest
from unittest.mock import patch
import zlib

spec = importlib.util.spec_from_file_location("candidate_evidence", Path(__file__).with_name("candidate_evidence.py"))
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)
SHA = "a" * 40
BROWSER = "desktop-chromium"


def png(width=64, height=40):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    random_bytes = random.Random(7).randbytes(width * height * 3)
    pixels = b"".join(b"\0" + random_bytes[row * width * 3:(row + 1) * width * 3] for row in range(height))
    return (evidence.PNG_SIGNATURE + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) +
            chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b""))


def unpack(log):
    return [json.loads(line[len(evidence.PREFIX):]) for line in log.splitlines()]


def pack(records):
    return "".join(evidence.PREFIX + evidence.canonical(record) + "\n" for record in records)


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.fixtures = self.root / "operations"
        self.original = self.make_operations(self.fixtures)
        self.log = evidence.encode(self.fixtures, SHA, BROWSER, "operations")

    def make_operations(self, root, browser=BROWSER):
        files = {}
        for index, name in enumerate(evidence.OPERATIONS_NAMES):
            relative = f"operations-fixture-{index}-{browser}/{name}"
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            data = png(64 + index, 40)
            target.write_bytes(data)
            files[relative] = data
        return files

    def make_room(self, browser):
        root = self.root / browser / "room-entry"
        target = root / f"room-reduced-motion-{browser}" / "room-reduced-motion.png"
        target.parent.mkdir(parents=True)
        target.write_bytes(png())
        if browser != BROWSER:
            for short in (False, True):
                directory = root / f"room-natural-{'short' if short else 'normal'}-{browser}"
                directory.mkdir()
                for name in ("room-natural-entry.png", "room-natural-complete.png"):
                    (directory / name).write_bytes(png())
                value = {"project": browser, "shortViewport": short,
                         "input": ("Chromium touch input in an emulated mobile viewport" if browser == "mobile-chromium"
                                   else "WebKit mobile viewport with incremental programmatic scrolling"),
                         "samples": [{"time": 1}], "insertions": []}
                (directory / "room-natural-entry.json").write_text(json.dumps(value))
        return root

    def decode(self, log=None, source_sha=SHA, browser=BROWSER, stage="operations"):
        return evidence.decode(self.log if log is None else log, source_sha, browser, stage)

    def reject(self, records):
        with self.assertRaises(evidence.EvidenceError):
            self.decode(pack(records))

    def test_lossless_roundtrip_and_manifest(self):
        manifest, files = self.decode()
        self.assertEqual(files, self.original)
        self.assertEqual(manifest["source_sha"], SHA)
        self.assertEqual(manifest["total_bytes"], sum(map(len, self.original.values())))
        self.assertEqual({Path(entry["path"]).name for entry in manifest["files"]}, set(evidence.OPERATIONS_NAMES))
        for entry in manifest["files"]:
            self.assertEqual(entry["sha256"], evidence.digest(files[entry["path"]]))
            self.assertGreater(entry["chunks"], 1)

    def test_timestamped_full_job_log_selects_one_browser_and_stage(self):
        other = self.root / "mobile"
        self.make_operations(other, "mobile-chromium")
        room = self.make_room(BROWSER)
        full = ("ordinary job output\n" + evidence.encode(other, SHA, "mobile-chromium", "operations") +
                evidence.encode(room, SHA, BROWSER, "room-entry") + self.log + "done\n")
        full = "".join("2026-10-02T14:00:00Z " + line + "\n" for line in full.splitlines())
        self.assertEqual(self.decode(full)[1], self.original)

    def test_all_three_room_profiles_roundtrip(self):
        for browser in evidence.BROWSERS:
            with self.subTest(browser=browser):
                root = self.make_room(browser)
                log = evidence.encode(root, SHA, browser, "room-entry")
                manifest, files = self.decode(log, browser=browser, stage="room-entry")
                self.assertEqual(len(files), 1 if browser == BROWSER else 7)
                for relative, data in files.items():
                    self.assertEqual(data, (root / relative).read_bytes())
                self.assertEqual(manifest["stage"], "room-entry")

    def test_missing_each_required_operations_image_is_fatal(self):
        for relative, data in self.original.items():
            path = self.fixtures / relative
            path.unlink()
            with self.subTest(path=relative), self.assertRaises(evidence.EvidenceError):
                evidence.encode(self.fixtures, SHA, BROWSER, "operations")
            path.write_bytes(data)

    def test_missing_room_pair_or_wrong_viewport_is_fatal(self):
        root = self.make_room("mobile-chromium")
        missing = next(root.rglob("room-natural-complete.png"))
        data = missing.read_bytes()
        missing.unlink()
        with self.assertRaises(evidence.EvidenceError):
            evidence.encode(root, SHA, "mobile-chromium", "room-entry")
        missing.write_bytes(data)
        short = next(root.glob("*short*/room-natural-entry.json"))
        value = json.loads(short.read_text())
        value["shortViewport"] = False
        short.write_text(json.dumps(value))
        with self.assertRaises(evidence.EvidenceError):
            evidence.encode(root, SHA, "mobile-chromium", "room-entry")

    def test_room_json_mixed_browser_is_fatal(self):
        root = self.make_room("mobile-webkit")
        path = next(root.rglob("room-natural-entry.json"))
        value = json.loads(path.read_text())
        value["project"] = "mobile-chromium"
        path.write_text(json.dumps(value))
        with self.assertRaises(evidence.EvidenceError):
            evidence.encode(root, SHA, "mobile-webkit", "room-entry")

    def test_extra_duplicate_required_image_is_fatal(self):
        path = self.fixtures / f"duplicate-{BROWSER}" / evidence.OPERATIONS_NAMES[0]
        path.parent.mkdir()
        path.write_bytes(png())
        with self.assertRaises(evidence.EvidenceError):
            evidence.encode(self.fixtures, SHA, BROWSER, "operations")

    def test_non_allowlisted_outputs_are_not_collected(self):
        (self.fixtures / "credentials.json").write_text("DO NOT LOG THIS")
        (self.fixtures / "trace.zip").write_bytes(b"private trace")
        encoded = evidence.encode(self.fixtures, SHA, BROWSER, "operations")
        self.assertNotIn("DO NOT LOG THIS", encoded)
        self.assertNotIn("credentials.json", encoded)
        self.assertEqual(self.decode(encoded)[1], self.original)

    def test_tampered_chunk_digest_is_fatal(self):
        records = unpack(self.log)
        data = bytearray(base64.b64decode(records[1]["data"]))
        data[-1] ^= 1
        records[1]["data"] = base64.b64encode(data).decode()
        self.reject(records)

    def test_missing_duplicate_and_reordered_chunks_are_fatal(self):
        records = unpack(self.log)
        self.reject(records[:2] + records[3:])
        self.reject(records[:2] + [records[1]] + records[2:])
        self.reject(records[:1] + [records[2], records[1]] + records[3:])

    def test_missing_header_end_and_duplicate_stream_are_fatal(self):
        records = unpack(self.log)
        self.reject(records[1:])
        self.reject(records[:-1])
        self.reject(records + records)
        self.reject(records + [records[-1]])

    def test_truncated_and_malformed_base64_are_fatal(self):
        for value in ("AAAA", "!?@@", "", "é", "A" * 8192):
            records = unpack(self.log)
            records[1]["data"] = value
            with self.subTest(value=value[:10]):
                self.reject(records)

    def test_mixed_source_browser_and_stage_are_fatal(self):
        for field, value in (("source_sha", "b" * 40), ("browser", "mobile-webkit"), ("stage", "room-entry")):
            records = unpack(self.log)
            records[1][field] = value
            with self.subTest(field=field):
                self.reject(records)
        with self.assertRaises(evidence.EvidenceError):
            self.decode(source_sha="b" * 40)

    def test_tampered_manifest_and_counts_are_fatal(self):
        for field, value in (("manifest_sha256", "0" * 64), ("total_bytes", 1), ("total_bytes", True)):
            records = unpack(self.log)
            records[0][field] = value
            self.reject(records)
        records = unpack(self.log)
        records[-1]["file_count"] = 1
        self.reject(records)
        records = unpack(self.log)
        records[1]["number"] = True
        self.reject(records)
        records = unpack(self.log)
        records[1]["total"] += 1
        self.reject(records)

    def test_duplicate_and_incomplete_manifest_are_fatal(self):
        for mode in ("duplicate", "missing"):
            records = unpack(self.log)
            entries = records[0]["files"]
            if mode == "duplicate":
                entries[1] = dict(entries[0])
            else:
                entries.pop()
            records[0]["manifest_sha256"] = evidence.digest(evidence.canonical(entries).encode())
            records[0]["total_bytes"] = sum(entry["bytes"] for entry in entries)
            self.reject(records)

    def test_unsafe_paths_and_foreign_browser_paths_are_fatal(self):
        name = evidence.OPERATIONS_NAMES[0]
        for path in (f"../{name}", f"/absolute/{name}", f"a/../{name}", f"a\\{name}",
                     f"a//{name}", f"a-mobile-webkit/{name}", f"a-{BROWSER}/credentials.json"):
            with self.subTest(path=path), self.assertRaises(evidence.EvidenceError):
                evidence.safe_path(path, BROWSER, "operations")
        records = unpack(self.log)
        records[0]["files"][0]["path"] = "../../fee-effective-time.png"
        self.reject(records)

    def test_symlink_inputs_and_destinations_are_fatal(self):
        relative = next(iter(self.original))
        path = self.fixtures / relative
        original = self.root / "real.png"
        original.write_bytes(path.read_bytes())
        path.unlink()
        path.symlink_to(original)
        with self.assertRaises(evidence.EvidenceError):
            evidence.encode(self.fixtures, SHA, BROWSER, "operations")
        out = self.root / "linked"
        out.symlink_to(self.root / "real-dir")
        with self.assertRaises(evidence.EvidenceError):
            evidence.write_decoded(out / "review", *self.decode())

    def test_explicit_byte_limits_fail_closed(self):
        with patch.object(evidence, "MAX_STAGE_BYTES", 50):
            with self.assertRaises(evidence.EvidenceError):
                evidence.encode(self.fixtures, SHA, BROWSER, "operations")
            with self.assertRaises(evidence.EvidenceError):
                self.decode()
        with patch.object(evidence, "MAX_LOG_BYTES", 50), self.assertRaises(evidence.EvidenceError):
            self.decode()
        with patch.object(evidence, "MAX_LINE_BYTES", 50), self.assertRaises(evidence.EvidenceError):
            self.decode()

    def test_invalid_png_crc_truncation_and_payload_fail_closed(self):
        valid = png()
        for invalid in (b"not a png", valid[:-1], valid + b"trailing", valid[:40] + b"X" + valid[41:]):
            with self.subTest(size=len(invalid)), self.assertRaises(evidence.EvidenceError):
                evidence.validate_png(invalid)
        with patch.object(evidence, "MAX_PNG_PIXELS", 1), self.assertRaises(evidence.EvidenceError):
            evidence.validate_png(valid)

    def test_malformed_json_duplicate_keys_and_unknown_records_fail_closed(self):
        for log in (evidence.PREFIX + "{", self.log.replace('"browser":', '"browser":"mobile-webkit","browser":', 1)):
            with self.assertRaises(evidence.EvidenceError):
                self.decode(log)
        records = unpack(self.log)
        records[1]["type"] = "ignored"
        self.reject(records)
        records = unpack(self.log)
        records[1]["extra"] = "ignored"
        self.reject(records)

    def test_invalid_source_or_unknown_identity_fail_closed(self):
        for sha in ("HEAD", "A" * 40, "a" * 39, SHA + "\n"):
            with self.assertRaises(evidence.EvidenceError):
                self.decode(source_sha=sha)
        with self.assertRaises(evidence.EvidenceError):
            self.decode(browser="chrome")

    def test_decode_cli_writes_verified_original_bytes_and_no_overwrite(self):
        log = self.root / "job.log"
        log.write_text(self.log)
        out = self.root / "review"
        args = ["decode", "--log", str(log), "--out", str(out), "--source-sha", SHA,
                "--browser", BROWSER, "--stage", "operations"]
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(evidence.main(args), 0)
        for relative, data in self.original.items():
            self.assertEqual((out / relative).read_bytes(), data)
        self.assertTrue((out / "evidence-manifest.json").is_file())
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(evidence.main(args), 1)

    def test_bad_log_writes_nothing_and_missing_screenshots_emit_nothing(self):
        log = self.root / "truncated.log"
        log.write_text(self.log[:-100])
        out = self.root / "no-output"
        with contextlib.redirect_stderr(io.StringIO()):
            result = evidence.main(["decode", "--log", str(log), "--out", str(out), "--source-sha", SHA,
                                    "--browser", BROWSER, "--stage", "operations"])
        self.assertEqual(result, 1)
        self.assertFalse(out.exists())
        (self.fixtures / next(iter(self.original))).unlink()
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(io.StringIO()):
            result = evidence.main(["encode", "--root", str(self.fixtures), "--source-sha", SHA,
                                    "--browser", BROWSER, "--stage", "operations"])
        self.assertEqual(result, 1)
        self.assertEqual(stdout.getvalue(), "")


class CandidateWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/candidate-checks.yml").read_text()

    def test_single_named_read_only_job_without_artifacts_or_caches(self):
        workflow = self.workflow
        self.assertIn("jobs:\n  verify:\n    name: verify\n", workflow)
        self.assertEqual(re.findall(r"^  ([a-z_]+):$", workflow.split("jobs:\n", 1)[1], re.M), ["verify"])
        self.assertIn("permissions:\n  contents: read\n", workflow)
        self.assertNotIn("upload-artifact", workflow)
        self.assertNotIn("download-artifact", workflow)
        self.assertNotIn("actions/cache", workflow)
        self.assertNotIn("cache: npm", workflow)
        self.assertNotIn("continue-on-error", workflow)
        self.assertNotIn("strategy:", workflow)
        self.assertIn("timeout-minutes: 120", workflow)
        names = re.findall(r"^      - name: (.+)$", workflow, re.M)
        self.assertEqual(len(names), len(set(names)), "Every gate needs its own unambiguous job step")

    def test_core_gates_and_build_once(self):
        for command in ("npm ci --no-audit", "npm audit --audit-level=moderate", "npm run lint", "npm run typecheck",
                        "npm test", "npx drizzle-kit check", "npx wrangler deploy --config dist/server/wrangler.json --dry-run --outdir dist/worker-dry-run"):
            self.assertIn("run: " + command, self.workflow)
        self.assertEqual(self.workflow.count("run: npm test\n"), 1)
        self.assertEqual(self.workflow.count('tar -czf "$archive" dist/client dist/server'), 1)
        self.assertIn("npx playwright install --with-deps chromium webkit", self.workflow)
        self.assertIn("test_candidate_evidence.py", self.workflow)

    def test_every_browser_has_independent_gates_and_pristine_restore(self):
        for browser in evidence.BROWSERS:
            bid = browser.replace("-", "_")
            start = self.workflow.index(f"      - name: Verify and restore the exact candidate build ({browser})")
            next_browser = self.workflow.find("      - name: Verify and restore the exact candidate build (", start + 1)
            block = self.workflow[start:next_browser] if next_browser >= 0 else self.workflow[start:]
            self.assertIn("steps.source.outcome == 'success' && steps.build.outcome == 'success' && steps.browsers.outcome == 'success'", block)
            self.assertIn('test "$(git rev-parse HEAD)" = "$BUILD_SHA"', block)
            self.assertIn('test "$(git rev-parse HEAD^{tree})" = "$BUILD_TREE"', block)
            self.assertIn('test "$(sha256sum "$archive" | cut -d \' \' -f 1)" = "$BUILD_DIGEST"', block)
            self.assertIn('test "$RUNNER_ENVIRONMENT" = github-hosted', block)
            self.assertIn('test -z "${E2E_BASE_URL:-}"', block)
            self.assertIn("rm -rf -- dist .wrangler test-results playwright-report", block)
            self.assertIn('tar -xzf "$archive"', block)
            self.assertIn("npx wrangler d1 migrations apply DB --local --persist-to .wrangler/state", block)
            self.assertEqual(block.count(f"if: ${{{{ !cancelled() && steps.fixtures_{bid}.outcome == 'success' }}}}"), 10)
            commands = [
                f"npx playwright test tests/e2e/room-natural-entry.spec.ts --project {browser} --workers=1 --retries=0 --output test-results/room-entry",
                f"npx playwright test --project {browser}\n",
                f"npx playwright test tests/e2e/navigation-audit.spec.ts --project {browser} --workers=1 --retries=0 --repeat-each=3 --output test-results/navigation-focus",
                f"npx playwright test --config playwright.seev.config.ts --project {browser} --output test-results/seevplus",
                f"npx playwright test --config playwright.seev-crypto.config.ts --project {browser} --output test-results/seevplus-crypto",
                f"npx playwright test --config playwright.registration.config.ts --project {browser} --output test-results/registration",
                f"npx playwright test --config playwright.operations.config.ts --project {browser} --workers=1 --retries=0 --output test-results/operations",
                f"npx playwright test --config playwright.operations.config.ts --project {browser} --grep 'host lands on their event' --workers=1 --retries=0 --repeat-each=3 --output test-results/host-overview",
            ]
            for command in commands:
                self.assertIn(command, block)
            self.assertEqual(block.count('candidate_evidence.py encode --root test-results/'), 2)
            self.assertLess(block.index("--output test-results/room-entry"), block.index("--root test-results/room-entry"))
            self.assertLess(block.index("--root test-results/room-entry"), block.index(f"npx playwright test --project {browser}\n"))
            self.assertLess(block.index("--output test-results/operations"), block.index("--root test-results/operations"))
            self.assertLess(block.index("--root test-results/operations"), block.index("--output test-results/host-overview"))


if __name__ == "__main__":
    unittest.main()
