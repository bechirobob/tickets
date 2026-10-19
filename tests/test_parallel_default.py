"""Default route regressions: no network, credentials, skipped coverage or deployment."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'ops/vps'))
import parallel_candidate
import parallel_candidate_control

spec = importlib.util.spec_from_file_location('default_release', ROOT / 'ops/vps/code-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class BranchBoundaryTests(unittest.TestCase):
    def test_native_workflows_require_explicit_manual_dispatch(self):
        for name in ('native-apps', 'iphone-layouts', 'android-release', 'ios-release'):
            text=(ROOT/f'.github/workflows/{name}.yml').read_text()
            events=text.split('on:\n',1)[1].split('\npermissions:',1)[0]
            self.assertIn('  workflow_dispatch:',events,name)
            for event in ('pull_request:', 'push:', 'workflow_run:', 'schedule:'):
                self.assertNotIn(event,events,name)

    def test_all_release_trust_paths_use_unambiguous_remote_main_ref(self):
        for path in ('.github/workflows/candidate-checks.yml', '.github/workflows/candidate-parallel-checks.yml',
                     '.github/workflows/tickets-code-release.yml', '.github/workflows/vps-runtime.yml',
                     'ops/vps/code-release.py', 'ops/vps/parallel_candidate_control.py', 'ops/vps/candidate_build.py'):
            content=(ROOT/path).read_text()
            self.assertIn('refs/remotes/origin/main',content,path)
            self.assertNotIn('origin/main',content.replace('refs/remotes/origin/main',''),path)

    def test_independent_boundaries_agree_on_branch_events(self):
        for module in (release, parallel_candidate, parallel_candidate_control):
            for event in ('push', 'workflow_dispatch'):
                for branch in ('fix/cinco-email', 'release/approved-20261020', 'improve/release-evidence-parallel-20261013'):
                    with self.subTest(module=module.__name__, event=event, branch=branch):
                        self.assertTrue(module.eligible_parallel_branch(event, branch))
            self.assertTrue(module.eligible_parallel_branch('workflow_dispatch', 'main'))
            for event, branch in [('push','main'), ('pull_request','fix/email'), ('workflow_run','fix/email'),
                                  ('push','refs/heads/fix'), ('push','refs/pull/12/merge'), ('push','pull/12/head'),
                                  ('push','fix/../main'), ('push','fix//email'), ('push',True), ('push',''),
                                  ('push','fix/email\nmain'), ('push','a'*256)]:
                with self.subTest(module=module.__name__, event=event, branch=branch):
                    self.assertFalse(module.eligible_parallel_branch(event, branch))


class IndependentControlSelectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'repo'
        self.root.mkdir()
        self.git('init', '-q')
        self.git('config','user.email','fixture@example.invalid')
        self.git('config','user.name','Fixture')
        self.base = self.commit('base')
        self.git('update-ref','refs/remotes/origin/main',self.base)
        self.source = self.commit('candidate')
        self.output = Path(self.temp.name) / 'output'
        self.environment = Path(self.temp.name) / 'environment'
        workflow = (ROOT/'.github/workflows/candidate-parallel-checks.yml').read_text()
        step = workflow.split('      - name: Verify exact source ancestry before executing checkout code\n',1)[1]
        body = step.split('        run: |\n',1)[1].split('      - name:',1)[0]
        self.script = '\n'.join(line[10:] for line in body.splitlines() if line.strip())

    def git(self,*args):
        return subprocess.check_output(['git','-C',str(self.root),*args],text=True,stderr=subprocess.DEVNULL).strip()

    def commit(self,value):
        (self.root/'source.txt').write_text(value)
        self.git('add','source.txt'); self.git('commit','-qm',value)
        return self.git('rev-parse','HEAD')

    def run_selection(self, baseline=''):
        env = dict(os.environ, BECORE_RELEASE_SHA=self.source, BECORE_TRUSTED_BASE=baseline,
                   GITHUB_ENV=str(self.environment), GITHUB_OUTPUT=str(self.output))
        return subprocess.run(['bash','-c',self.script],cwd=self.root,env=env,capture_output=True,text=True)

    def test_omitted_input_selects_current_independent_main_and_exports_once(self):
        result=self.run_selection()
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(self.output.read_text(),f'trusted_base={self.base}\n')
        self.assertEqual(self.environment.read_text(),f'BECORE_TRUSTED_BASE={self.base}\n')

    def test_stale_branch_fails_without_selecting_old_common_ancestor(self):
        candidate=self.source
        self.git('checkout','-q',self.base)
        moved=self.commit('independent-main-update')
        self.git('update-ref','refs/remotes/origin/main',moved)
        self.git('checkout','-q',candidate)
        self.assertNotEqual(self.run_selection().returncode,0)
        self.assertFalse(self.output.exists())

    def test_shadow_tag_cannot_select_unreviewed_control_or_forge_main_ancestry(self):
        self.git('checkout','-q',self.base)
        real_main=self.commit('reviewed-main')
        self.git('update-ref','refs/remotes/origin/main',real_main)
        self.git('checkout','-q',self.base)
        unreviewed=self.commit('unreviewed-control')
        self.git('tag','origin/main',unreviewed)
        self.source=self.commit('candidate-on-unreviewed-control')
        self.assertNotEqual(self.run_selection().returncode,0)
        self.assertNotEqual(self.run_selection(unreviewed).returncode,0)
        self.assertFalse(self.output.exists())

    def test_candidate_cannot_select_itself_and_unknown_control_fails(self):
        for value in (self.source,'f'*40,'invalid;echo unsafe'):
            self.assertNotEqual(self.run_selection(value).returncode,0)
        self.assertFalse(self.output.exists())

    def test_explicit_independent_reviewed_ancestor_remains_supported(self):
        self.assertEqual(self.run_selection(self.base).returncode,0)
        self.assertEqual(self.output.read_text(),f'trusted_base={self.base}\n')


if __name__=='__main__': unittest.main()
