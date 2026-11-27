"""Exercise the exact release signing statement, direct routes and fallback privacy headers."""
import importlib.util
import json
import os
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
        subprocess.run(['python3', ROOT / 'scripts/build-account-links.py', self.bundle], check=True,
                       env=os.environ | {'ANDROID_ROTATED_CERTIFICATE': '24' * 32})
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
        certs[:] = [certs[0].lower()]
        self.statements.insert(0, {'target': {'namespace': 'web', 'site': 'https://example.test'}})
        self.verify()

    def test_only_rotated_certificate_delegated_after_rotation(self):
        rotated = "ab" * 32
        subprocess.run(["python3", ROOT / "scripts/build-account-links.py", self.bundle], check=True,
                       env=os.environ | {"ANDROID_ROTATED_CERTIFICATE": rotated})
        with self.assertRaisesRegex(ValueError, "does not delegate"):
            self.verify()
        self.statement["target"]["sha256_cert_fingerprints"].append(":".join(["AB"] * 32))
        with self.assertRaisesRegex(ValueError, "does not delegate"):
            self.verify()
        self.statement["target"]["sha256_cert_fingerprints"] = [":".join(["AB"] * 32)]
        self.verify()

    def test_missing_or_legacy_signer_does_not_generate_a_delegation(self):
        for pin in ('', '8194987893a64ee0abf250377c54a7d939b81743fa95020dd4a701ea45ad92b6'):
            with self.subTest(pin=pin), tempfile.TemporaryDirectory() as directory:
                result = subprocess.run(['python3', ROOT / 'scripts/build-account-links.py', directory],
                                        env=os.environ | {'ANDROID_ROTATED_CERTIFICATE': pin}, capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((Path(directory) / '.well-known/assetlinks.json').exists())

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
