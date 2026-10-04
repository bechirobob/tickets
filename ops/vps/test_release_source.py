"""Real-Git negative tests for ordinary release source and operator boundaries."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("release_source_tests", Path(__file__).with_name("code-release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.previous = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, self.previous)
        self.command("init", "-q")
        self.command("config", "user.name", "Release tests")
        self.command("config", "user.email", "tests@example.invalid")
        self.write("app/source.ts", "baseline source\n")
        self.initial = self.commit()
        self.write("ops/vps/code-release.py", "reviewed operator\n")
        self.write("scripts/checkbox-hotfix-audit-policy.json", "frozen historical record\n")
        self.baseline = self.commit()
        self.command("update-ref", "refs/remotes/origin/main", self.baseline)
        self.write("app/source.ts", "candidate source\n")
        self.candidate = self.commit()

    def command(self, *args):
        return subprocess.check_output(["git", *args], text=True, stderr=subprocess.DEVNULL).strip()

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def commit(self):
        self.command("add", "-A")
        self.command("commit", "-qm", "isolated fixture")
        return self.command("rev-parse", "HEAD")

    def verify_operator(self, baseline=None):
        with patch.dict(os.environ, BECORE_TRUSTED_BASE=baseline or self.baseline), \
             patch.object(release, "__file__", str(self.root / "ops/vps/code-release.py")):
            release.verify_trusted_operator(self.candidate)

    def test_ordinary_descendant_is_accepted_without_caption_snapshot(self):
        self.verify_operator()
        release.verify_changed_modes(self.baseline, self.candidate)

    def test_invalid_trust_or_source_sha_is_rejected(self):
        for value in ("", "HEAD", "a" * 12, "A" * 40, "--help", "a" * 40 + "^{commit}"):
            with self.subTest(value=value), patch.dict(os.environ, BECORE_TRUSTED_BASE=value):
                with self.assertRaises(release.ReleaseError):
                    release.verify_trusted_operator(self.candidate)
            with self.subTest(source=value), patch.dict(os.environ, BECORE_TRUSTED_BASE=self.baseline):
                with self.assertRaises(release.ReleaseError):
                    release.verify_trusted_operator(value)

    def test_source_cannot_self_authorize_as_its_control_baseline(self):
        with self.assertRaisesRegex(release.ReleaseError, "own trusted"):
            self.verify_operator(self.candidate)

    def test_baseline_outside_main_or_source_ancestry_fails(self):
        self.command("update-ref", "refs/remotes/origin/main", self.initial)
        with self.assertRaises(subprocess.CalledProcessError):
            self.verify_operator()
        orphan = self.command("commit-tree", self.command("rev-parse", self.baseline + "^{tree}"), "-m", "unrelated control")
        self.command("update-ref", "refs/remotes/origin/main", orphan)
        with self.assertRaises(subprocess.CalledProcessError):
            self.verify_operator(orphan)

    def test_substituted_operator_and_symlink_are_rejected(self):
        path = self.root / "ops/vps/code-release.py"
        path.write_text("unreviewed operator\n")
        with self.assertRaisesRegex(release.ReleaseError, "Operator bytes"):
            self.verify_operator()
        path.unlink()
        target = self.root / "operator-target.py"
        target.write_text("reviewed operator\n")
        path.symlink_to(target)
        with self.assertRaisesRegex(release.ReleaseError, "regular file"):
            self.verify_operator()

    def test_git_replacement_and_environment_do_not_change_verified_objects(self):
        self.command("replace", self.baseline, self.candidate)
        with patch.dict(os.environ, GIT_DIR="/not/the/repository", GIT_WORK_TREE="/not/the/tree",
                        GIT_CONFIG_COUNT="1", GIT_CONFIG_KEY_0="core.worktree", GIT_CONFIG_VALUE_0="/wrong",
                        GIT_REPLACE_REF_BASE="refs/replace"):
            self.assertEqual(release.git("show", self.baseline + ":app/source.ts"), "baseline source")
            self.verify_operator()

    def test_mode_changes_symlinks_and_deletions_fail_closed(self):
        path = self.root / "app/source.ts"
        path.chmod(0o755)
        changed = self.commit()
        with self.assertRaisesRegex(release.ReleaseError, "mode changed"):
            release.verify_changed_modes(self.candidate, changed)
        path.unlink()
        path.symlink_to("../../outside")
        linked = self.commit()
        with self.assertRaises(release.ReleaseError):
            release.verify_changed_modes(changed, linked)
        path.unlink()
        removed = self.commit()
        with self.assertRaisesRegex(release.ReleaseError, "deletion or type"):
            release.verify_changed_modes(linked, removed)

    def test_new_executable_source_is_not_implicitly_authorized(self):
        path = self.root / "new-script.sh"
        path.write_text("#!/bin/sh\nexit 0\n")
        path.chmod(0o755)
        added = self.commit()
        with self.assertRaisesRegex(release.ReleaseError, "New executable"):
            release.verify_changed_modes(self.candidate, added)

    def test_actual_shell_preflights_reject_staged_changes_hidden_by_worktree(self):
        workflow_root = Path(__file__).resolve().parents[2] / ".github/workflows"
        self.command("update-ref", "refs/remotes/origin/main", self.candidate)
        env = dict(os.environ, BECORE_TRUSTED_BASE=self.baseline,
                   BECORE_RELEASE_SHA=self.candidate, GITHUB_REF="refs/heads/main")
        scripts = []
        for name in ("candidate-checks.yml", "vps-runtime.yml", "deploy.yml"):
            text = (workflow_root / name).read_text()
            for block in text.split("- name: Verify exact source ancestry before executing checkout code")[1:]:
                block = block.split("\n      - ", 1)[0]
                script = block.split("        run: |\n", 1)[1]
                scripts.append("\n".join(line[10:] for line in script.splitlines()))
        self.assertEqual(len(scripts), 4)
        for script in scripts:
            self.assertEqual(subprocess.run(["bash", "-c", script], env=env,
                                           capture_output=True).returncode, 0)
        self.write("app/source.ts", "unreviewed staged source\n")
        self.command("add", "app/source.ts")
        self.write("app/source.ts", "candidate source\n")
        self.assertEqual(self.command("diff", "HEAD", "--"), "")
        self.assertTrue(self.command("status", "--porcelain").startswith("MM "))
        for script in scripts:
            self.assertNotEqual(subprocess.run(["bash", "-c", script], env=env,
                                              capture_output=True).returncode, 0)

    def test_retired_audit_policy_has_no_path_bypass(self):
        name = "scripts/checkbox-hotfix-audit-policy.json"
        expected = self.command("rev-parse", self.baseline + ":" + name)
        self.write(name, "changed scope\n")
        changed = self.commit()
        with patch.dict(release.REVIEWED_APPLICATION_BLOBS, {name: expected}, clear=True):
            with self.assertRaisesRegex(release.ReleaseError, "reviewed source"):
                release.vetted_changes(self.candidate, changed)


if __name__ == "__main__":
    unittest.main()
