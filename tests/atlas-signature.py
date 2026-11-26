"""Check the publication CLI against temporary independent keys and altered editions."""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/atlas-signature.py'


def key_pair():
    private = subprocess.check_output(['openssl', 'genpkey', '-algorithm', 'EC',
                                       '-pkeyopt', 'ec_paramgen_curve:prime256v1'])
    public = subprocess.check_output(['openssl', 'pkey', '-pubout', '-outform', 'DER'], input=private)
    return {'ANGLER_ATLAS_SIGNING_KEY': private.decode(), 'ANGLER_ATLAS_PUBLIC_KEY': base64.b64encode(public).decode()}


class AtlasSignatureTest(unittest.TestCase):
    def test_every_published_field_is_bound_to_the_pinned_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'manifest.json'
            pin = key_pair()
            fields = dict(format=1, commit='1'*40, sha256='2'*64, registrySha256='3'*64,
                          bytes=512, unpacked=1024, asOf='2026-11-25')
            def run(key, *options):
                return subprocess.run([sys.executable, str(SCRIPT), *options, str(file)],
                                      env=os.environ | key, capture_output=True).returncode
            file.write_text(json.dumps(fields))
            self.assertNotEqual(run(pin), 0)
            self.assertEqual(run(pin, '--sign'), 0)
            self.assertEqual(run({'ANGLER_ATLAS_PUBLIC_KEY': pin['ANGLER_ATLAS_PUBLIC_KEY']}), 0)
            self.assertNotEqual(run(key_pair()), 0)
            signed = json.loads(file.read_text())
            for field, value in dict(format=2, commit='4'*40, sha256='5'*64,
                                     registrySha256='6'*64, bytes=513, unpacked=1025, asOf='2026-11-26').items():
                with self.subTest(field=field):
                    file.write_text(json.dumps(signed | {field: value}))
                    self.assertNotEqual(run(pin), 0)


if __name__ == '__main__':
    unittest.main()
