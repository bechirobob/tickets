"""Offline npm/packaging regressions; every mutation uses an isolated fixture."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/vps-runtime.yml"
STEP = "Prepare verified runtime without development dependencies"
INTEGRITY_CHECK = "git diff --exit-code --stat HEAD --"


def packaging_script():
    workflow = WORKFLOW.read_text()
    match = re.search(r"      - name: " + re.escape(STEP)
                      + r"\n        run: \|\n((?:          .*\n)+)", workflow)
    if not match:
        raise AssertionError("Runtime packaging step is missing")
    return "\n".join(line[10:] for line in match[1].splitlines()) + "\n"


class RuntimePackagingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="tickets-runtime-packaging-")
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.root = self.directory / "project"
        self.root.mkdir()
        self.npm = shutil.which("npm")
        self.assertIsNotNone(self.npm, "npm is required for runtime packaging regressions")
        self.env = {key: value for key, value in os.environ.items()
                    if not key.lower().startswith("npm_config_") and key != "NODE_ENV"}
        self.env.update({"HOME": str(self.directory), "npm_config_offline": "true",
                         "npm_config_audit": "false", "npm_config_fund": "false",
                         "npm_config_cache": str(self.directory / "npm-cache"),
                         "npm_config_userconfig": str(self.directory / "empty.npmrc")})
        (self.directory / "empty.npmrc").write_text("")
        self.script = packaging_script()
        self.source_files = ("package.json", "package-lock.json", "tracked-source.txt")
        self.prepare_fixture()

    def run_command(self, *command, check=True):
        result = subprocess.run(command, cwd=self.root, env=self.env, text=True,
                                capture_output=True, timeout=60)
        if check:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def prepare_fixture(self):
        # Tarballs are constructed locally and installed from the committed lock.
        # No registry, existing npm cache, project node_modules or symlink is used.
        packages = {
            "runtime-fixture": {"name": "runtime-fixture", "version": "1.2.3",
                                "optionalDependencies": {"shared-fixture": "1.0.0"}},
            "shared-fixture": {"name": "shared-fixture", "version": "1.0.0"},
            "development-fixture": {"name": "development-fixture", "version": "1.0.0"},
        }
        manifest = {"name": "runtime-packaging-fixture", "version": "1.0.0", "private": True,
                    "dependencies": {"runtime-fixture": "^1.0.0"},
                    "devDependencies": {"development-fixture": "1.0.0"},
                    "scripts": {"preinstall": "node -e 'process.exit(99)'",
                                "install": "node -e 'process.exit(99)'",
                                "postinstall": "node -e 'process.exit(99)'"}}
        locked = {"": manifest}
        for name, package in packages.items():
            package["scripts"] = {"install": "node -e 'process.exit(99)'"}
            path = self.root / (name + ".tgz")
            with tarfile.open(path, "w:gz") as archive:
                for filename, content in {
                    "package.json": json.dumps(package).encode(),
                    "index.js": f"module.exports = '{name}@{package['version']}';\n".encode(),
                }.items():
                    item = tarfile.TarInfo("package/" + filename)
                    item.size = len(content)
                    archive.addfile(item, io.BytesIO(content))
            locked["node_modules/" + name] = {
                "version": package["version"], "resolved": "file:" + path.name,
                "integrity": "sha512-" + base64.b64encode(hashlib.sha512(path.read_bytes()).digest()).decode(),
                "hasInstallScript": True,
            }
            if "optionalDependencies" in package:
                locked["node_modules/" + name]["optionalDependencies"] = package["optionalDependencies"]
        locked["node_modules/development-fixture"]["dev"] = True
        # Reproduce npm's normalization of stale optional/dev classification,
        # as observed in Tickets' @esbuild platform and fsevents lock entries.
        locked["node_modules/shared-fixture"].update({"dev": True, "optional": True})
        lock = {"name": manifest["name"], "version": manifest["version"],
                "lockfileVersion": 3, "requires": True, "packages": locked}
        (self.root / "package.json").write_text(json.dumps(manifest, indent=2) + "\n")
        (self.root / "package-lock.json").write_text(json.dumps(lock, indent=2) + "\n")
        (self.root / "tracked-source.txt").write_text("Reviewed source must stay unchanged.\n")
        (self.root / ".gitignore").write_text("node_modules/\ndist-vps/\ntickets-vps-runtime.tar.gz*\n")
        (self.root / "scripts").mkdir()
        # A fixture-only preparation step exercises shell/source/archive contracts.
        # The real dependency selector/copy helper has separate Node unit tests.
        (self.root / "scripts/prepare-vps-runtime.mjs").write_text(
            "import assert from 'node:assert/strict';\n"
            "import { cp, mkdir } from 'node:fs/promises';\n"
            "import { existsSync } from 'node:fs';\n"
            "await mkdir('dist-vps/node_modules');\n"
            "for (const name of ['runtime-fixture', 'shared-fixture']) await cp('node_modules/' + name, 'dist-vps/node_modules/' + name, {recursive:true});\n"
            "assert.equal(existsSync('node_modules/development-fixture'), true);\n"
            "assert.equal(existsSync('dist-vps/node_modules/development-fixture'), false);\n"
            "assert.equal(existsSync('dist-vps/node_modules/extraneous-fixture'), false);\n")
        for name in ("dist-vps", "drizzle", "ops/vps"):
            (self.root / name).mkdir(parents=True)
            (self.root / name / "fixture.txt").write_text(name + " fixture\n")
        self.before = {name: (self.root / name).read_bytes() for name in self.source_files}
        self.run_command(self.npm, "ci", "--ignore-scripts")
        self.assert_source_unchanged()
        self.assertFalse((self.root / "node_modules").is_symlink())
        extra = self.root / "node_modules/extraneous-fixture"
        extra.mkdir()
        (extra / "package.json").write_text('{"name":"extraneous-fixture","version":"1.0.0"}')
        self.production_before = self.production_files()
        self.run_command("git", "init", "-q")
        self.run_command("git", "add", ".")
        self.run_command("git", "-c", "user.name=Packaging Test", "-c", "user.email=packaging@example.invalid",
                         "-c", "commit.gpgsign=false", "commit", "-qm", "Isolated fixture")

    def production_files(self):
        return {str(path.relative_to(self.root / "node_modules")): path.read_bytes()
                for name in ("runtime-fixture", "shared-fixture")
                for path in (self.root / "node_modules" / name).rglob("*") if path.is_file()}

    def assert_source_unchanged(self):
        self.assertEqual({name: (self.root / name).read_bytes() for name in self.source_files}, self.before)

    def run_packaging(self, check=True):
        return self.run_command("bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", self.script, check=check)

    def test_workflow_keeps_locked_input_and_all_verification_gates(self):
        self.assertIn("node scripts/prepare-vps-runtime.mjs", self.script)
        self.assertNotIn("npm prune", self.script)
        self.assertNotIn("cp -a node_modules", self.script)
        self.assertNotIn("--package-lock=false", self.script)
        self.assertNotIn("--no-package-lock", self.script)
        self.assertEqual(self.script.count(INTEGRITY_CHECK), 2)
        self.assertLess(self.script.index(INTEGRITY_CHECK), self.script.index("node scripts/prepare-vps-runtime.mjs"))
        self.assertLess(self.script.index("node scripts/prepare-vps-runtime.mjs"), self.script.rindex(INTEGRITY_CHECK))
        workflow = WORKFLOW.read_text()
        for command in ("npm ci --no-audit", 'python3 -I "$RUNNER_TEMP/tickets-approved-audit.py" --phase preinstall', "npm run lint", "npm run typecheck",
                        "npm test", "npm run test:vps", "python -m unittest discover -s ops/vps -p 'test_*.py'",
                        "npm run build:vps", "node scripts/verify-vps-runtime.mjs"):
            self.assertLess(workflow.index("run: " + command), workflow.index("- name: " + STEP))
        self.assertLess(workflow.index("- name: " + STEP), workflow.index("- name: Publish verified public runtime release"))
        self.assertNotRegex(self.script, r"git\s+(?:reset|checkout|restore)\b")

    def test_original_prune_rewrites_lock_classification(self):
        self.run_command(self.npm, "prune", "--omit=dev", "--ignore-scripts")
        self.assertEqual((self.root / "package.json").read_bytes(), self.before["package.json"])
        self.assertNotEqual((self.root / "package-lock.json").read_bytes(), self.before["package-lock.json"])
        lock = json.loads((self.root / "package-lock.json").read_text())
        self.assertNotIn("dev", lock["packages"]["node_modules/shared-fixture"])
        self.assertEqual(self.production_files(), self.production_before)
        self.assertNotEqual(self.run_command("git", "diff", "--exit-code", "--quiet", "HEAD", "--", check=False).returncode, 0)

    def test_packaging_copies_only_runtime_and_preserves_the_source_install(self):
        self.run_packaging()
        self.assert_source_unchanged()
        self.assertEqual(self.production_files(), self.production_before)
        self.assertTrue((self.root / "node_modules/development-fixture").exists())
        self.assertTrue((self.root / "node_modules/extraneous-fixture").exists())
        self.assertEqual(self.run_command("git", "status", "--porcelain").stdout, "")
        archive = self.root / "tickets-vps-runtime.tar.gz"
        with tarfile.open(archive) as runtime:
            names = runtime.getnames()
            self.assertNotIn("./node_modules/development-fixture", names)
            self.assertNotIn("./node_modules/extraneous-fixture", names)
            for name, content in self.production_before.items():
                self.assertEqual(runtime.extractfile("./node_modules/" + name).read(), content)
        checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
        self.assertEqual((self.root / "tickets-vps-runtime.tar.gz.sha256").read_text(),
                         checksum + "  tickets-vps-runtime.tar.gz\n")

    def test_packaging_rejects_preexisting_staged_and_unstaged_source_drift(self):
        for staged in (False, True):
            with self.subTest(staged=staged):
                (self.root / "tracked-source.txt").write_text("Source changed before packaging.\n")
                if staged:
                    self.run_command("git", "add", "tracked-source.txt")
                result = self.run_packaging(check=False)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("tracked-source.txt", result.stdout)
                self.assertTrue((self.root / "node_modules/development-fixture").exists())
                self.assertFalse((self.root / "tickets-vps-runtime.tar.gz").exists())

    def test_packaging_rejects_source_drift_introduced_by_preparation(self):
        wrappers = self.directory / "wrappers"
        wrappers.mkdir()
        wrapper = wrappers / "node"
        wrapper.write_text(f'#!/bin/sh\n"{shutil.which("node")}" "$@" || exit $?\nprintf "changed during preparation\\n" >> tracked-source.txt\n')
        wrapper.chmod(0o755)
        self.env["PATH"] = str(wrappers) + os.pathsep + self.env["PATH"]
        result = self.run_packaging(check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("tracked-source.txt", result.stdout)
        self.assertTrue((self.root / "node_modules/development-fixture").exists())
        self.assertFalse((self.root / "tickets-vps-runtime.tar.gz").exists())
        self.assertNotEqual((self.root / "tracked-source.txt").read_bytes(), self.before["tracked-source.txt"])


if __name__ == "__main__":
    unittest.main()
