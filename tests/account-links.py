"""Exercise the exact release signing statement, direct routes and fallback privacy headers."""
import importlib.util
import json
import subprocess
import tempfile
import unittest
import urllib.error
from email.message import Message
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('account_links', ROOT / 'scripts/check-account-links.py')
links = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(links)


class AccountLinksTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.bundle = Path(temp.name)
        subprocess.run(['python3', ROOT / 'scripts/build-account-links.py', self.bundle], check=True)
        self.statement = json.loads((self.bundle / '.well-known/assetlinks.json').read_bytes())[0]
        self.statements = [self.statement]
        self.callback = (self.bundle / 'account' / links.PACKAGE / 'callback.html').read_bytes()
        self.headers = Message()
        self.headers['Content-Type'] = 'text/html; charset=UTF-8'
        self.headers['Cache-Control'] = 'private, no-store'
        self.headers['Referrer-Policy'] = 'no-referrer'

    def serve(self, url):
        if url == 'https://example.test/.well-known/assetlinks.json':
            h = Message()
            h['Content-Type'] = 'application/json'
            return 200, h, json.dumps(self.statements).encode()
        self.assertEqual(url, 'https://example.test/account/app.anglers.journal/callback')
        return 200, self.headers, self.callback

    def verify(self):
        links.check('example.test', self.bundle, self.serve)

    def test_multiple_apps_and_certificates(self):
        certs = self.statement['target']['sha256_cert_fingerprints']
        certs[:] = ['00:' * 31 + '00', certs[0].lower()]
        self.statements.insert(0, {'target': {'namespace': 'web', 'site': 'https://example.test'}})
        self.verify()

    def test_preview_or_wrong_certificate_is_insufficient(self):
        self.statement['target']['package_name'] += '.preview'
        with self.assertRaisesRegex(ValueError, 'does not delegate'):
            self.verify()
        self.statement['target']['package_name'] = links.PACKAGE
        self.statement['target']['sha256_cert_fingerprints'] = []
        with self.assertRaisesRegex(ValueError, 'does not delegate'):
            self.verify()

    def test_redirect_never_counts_as_verification(self):
        def redirected(url):
            raise urllib.error.HTTPError(url, 301, 'redirect', {'Location': 'https://www.example.test'}, None)
        with self.assertRaisesRegex(ValueError, 'HTTP 301'):
            links.check('example.test', self.bundle, redirected)

    def test_generic_host_page_and_cacheable_callback(self):
        self.callback = b'<title>Home</title><p>Contact info@horistum.com</p>'
        with self.assertRaisesRegex(ValueError, 'account help'):
            self.verify()
        del self.headers['Cache-Control']
        with self.assertRaisesRegex(ValueError, 'no-store'):
            self.verify()


if __name__ == '__main__':
    unittest.main()
