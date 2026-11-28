"""Verify shipped WebView calls against Android annotations, including calls made through optional chaining."""
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import PARSERS, ROOT, descend, short, target


class AndroidBridge(unittest.TestCase):
    def test_journal_and_play_calls_have_compatible_native_signatures(self):
        """Check the receiver, method and argument count at each first-party JS bridge call site."""
        files = {'Device': ROOT / 'app/src/main/java/app/anglers/journal/FishingActivity.java',
                 'PlayMarket': ROOT / 'app/src/play/java/app/anglers/journal/PlayStore.java'}
        exposed = {}
        for bridge, source in files.items():
            signatures = set()
            for node in descend(PARSERS['.java'].parse(source.read_bytes()).root_node):
                if node.type != 'method_declaration':
                    continue
                modifiers = next((child for child in node.children if child.type == 'modifiers'), None)
                if modifiers and any(child.type == 'marker_annotation' and short(child) == '@JavascriptInterface'
                                     for child in modifiers.named_children):
                    params = node.child_by_field_name('parameters').named_children
                    signatures.add((short(node.child_by_field_name('name')), len(params)))
            self.assertTrue(signatures, bridge)
            exposed[bridge] = signatures
        seen = set()
        for path in (ROOT / 'app/src/main/assets').glob('*.js'):
            for node in descend(PARSERS['.js'].parse(path.read_bytes()).root_node):
                if node.type != 'call_expression':
                    continue
                callee = target(node).replace('?.', '.').removeprefix('window.').removeprefix('globalThis.')
                parts = callee.split('.')
                if len(parts) != 2 or parts[0] not in exposed:
                    continue
                bridge, name = parts
                seen.add(bridge)
                args = [child for child in node.child_by_field_name('arguments').named_children if child.type != 'comment']
                with self.subTest(path=path.name, line=node.start_point.row + 1, callee=callee):
                    self.assertIn((name, len(args)), exposed[bridge])
        self.assertEqual(seen, set(files))


if __name__ == '__main__':
    unittest.main()
