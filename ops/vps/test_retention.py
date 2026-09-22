import os
import pathlib
import tempfile
import unittest
from retention import clean


class RetentionTests(unittest.TestCase):
    def test_retains_active_rollback_recent_and_customer_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            releases = root / 'releases'
            releases.mkdir()
            items = []
            for n in range(7):
                item = releases / format(n, '040x')
                item.mkdir()
                os.utime(item, (n * 1000, n * 1000))
                items.append(item)
            (root / 'current').symlink_to(items[0])
            (root / 'previous').symlink_to(items[1])
            state = root / 'tickets.sqlite'
            state.write_text('customer records')
            (releases / 'unmanaged').mkdir()
            self.assertEqual(clean(root, now=1000000), 2)
            for n in (0, 1, 4, 5, 6):
                self.assertTrue(items[n].exists())
            self.assertEqual(state.read_text(), 'customer records')
            self.assertTrue((releases / 'unmanaged').exists())

    def test_does_not_follow_release_directory_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            outside = root / 'state'
            outside.mkdir()
            (root / 'releases').symlink_to(outside)
            with self.assertRaises(RuntimeError):
                clean(root)
