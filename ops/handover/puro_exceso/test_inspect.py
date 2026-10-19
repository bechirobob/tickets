import ast,pathlib,unittest
ROOT=pathlib.Path(__file__).parent
class InspectionContract(unittest.TestCase):
    def test_read_only_and_fixed_target(self):
        source=(ROOT/'inspect.py').read_text();ast.parse(source)
        for guard in ('mode=ro','PRAGMA query_only=ON','LOCK_SH|fcntl.LOCK_NB','45ae58430aea3bad312a8244432078a4ffde59f8','db.total_changes==0','/var/lib/becore-tickets/tickets.sqlite'):
            self.assertIn(guard,source)
        for node in ast.walk(ast.parse(source)):
            if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr=='execute':
                first=node.args[0]
                if isinstance(first,ast.Constant): self.assertTrue(first.value.startswith(('SELECT','PRAGMA','BEGIN')))
    def test_private_identity_fields_are_not_selected_for_output(self):
        source=(ROOT/'inspect.py').read_text()
        tree=ast.parse(source)
        queries=[node.value for node in ast.walk(tree) if isinstance(node,ast.Constant)
                 and isinstance(node.value,str) and node.value.startswith('SELECT e.slug')]
        self.assertEqual(len(queries),2)
        for query in queries:
            projection=query.split('\n      FROM ',1)[0]
            for private in ('organizer_name','contact_name','full_name','display_name','masked_email'):
                self.assertNotIn(private,projection)
        self.assertNotIn('identityEvidence',source)
        self.assertIn("value.pop('id')",source)
        self.assertIn("identity=value.pop('id')",source)
    def test_manual_only_workflow(self):
        text=(ROOT.parents[2]/'.github/workflows/puro-exceso-listing.yml').read_text()
        self.assertIn('workflow_dispatch:',text)
        self.assertNotIn('\n  push:',text)
        self.assertNotIn('contents: write',text)
        self.assertNotIn('pull_request_target',text)
        self.assertIn("github.ref == 'refs/heads/main'",text)
if __name__=='__main__':unittest.main()
