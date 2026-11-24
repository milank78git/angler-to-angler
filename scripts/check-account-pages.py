"""Check the exact public route without sending any account parameters to the host."""
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

URL = 'https://milank78git.github.io/angler-to-angler/account/'


class DirectResponse(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


if __name__ == '__main__':
    with tempfile.TemporaryDirectory() as temp:
        subprocess.run([sys.executable, Path(__file__).with_name('build-account-pages.py'), temp], check=True)
        expected = (Path(temp) / 'account/index.html').read_bytes()
        with urllib.request.build_opener(DirectResponse()).open(URL, timeout=15) as response:
            if (response.status != 200 or response.headers.get_content_type() != 'text/html'
                    or response.read(len(expected) + 1) != expected):
                sys.exit('The public Pages callback does not match this build.')
    print('Project callback is available and matches the reviewed page.')
