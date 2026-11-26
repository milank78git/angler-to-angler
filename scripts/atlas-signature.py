"""Sign or verify the fields used to identify an immutable atlas and its registry."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


def payload(m):
    fields = ('commit', 'sha256', 'registrySha256', 'bytes', 'unpacked', 'asOf')
    if (m.get('format') != 1 or not re.fullmatch(r'[0-9a-f]{40}', m['commit'])
            or any(not re.fullmatch(r'[0-9a-f]{64}', m[k]) for k in fields[1:3])
            or not all(type(m[k]) is int and m[k] > 0 for k in fields[3:5])
            or not re.fullmatch(r'\d{4}-\d\d-\d\d', m['asOf'])):
        raise ValueError('Invalid atlas manifest')
    return ('angler-atlas-v1\n' + ''.join(str(m[k]) + '\n' for k in fields)).encode('ascii')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--sign', action='store_true')
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    data = payload(manifest)
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        pub = work / 'public.der'
        pub.write_bytes(base64.b64decode(os.environ['ANGLER_ATLAS_PUBLIC_KEY'], validate=True))
        info = subprocess.run(['openssl','pkey','-pubin','-inform','DER','-in',str(pub),'-text','-noout'],
                              capture_output=True, check=True).stdout
        if b'ASN1 OID: prime256v1' not in info:
            raise ValueError('Expected a P-256 atlas public key')
        signature = work / 'signature'
        if args.sign:
            key = work / 'signer.pem'
            key.write_text(os.environ.pop('ANGLER_ATLAS_SIGNING_KEY'))
            signed = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', str(key)], input=data,
                                    capture_output=True, check=True).stdout
            manifest['signature'] = base64.b64encode(signed).decode()
        signature.write_bytes(base64.b64decode(manifest['signature'], validate=True))
        subprocess.run(['openssl', 'dgst', '-sha256', '-keyform', 'DER', '-verify', str(pub),
                        '-signature', str(signature)], input=data, check=True)
    if args.sign:
        args.manifest.write_text(json.dumps(manifest, separators=(',', ':')) + '\n')


if __name__ == '__main__':
    main()
