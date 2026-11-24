"""Check the exact public route without sending any account parameters to the host."""
import subprocess
import sys
import tempfile
import time
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
        opener = urllib.request.build_opener(DirectResponse())
        # A successful Pages deployment can precede its CDN update.
        for attempt in range(6):
            try:
                with opener.open(URL, timeout=15) as response:
                    if (response.status == 200 and response.headers.get_content_type() == 'text/html'
                            and response.read(len(expected) + 1) == expected):
                        break
            except OSError:
                pass
            if attempt < 5:
                time.sleep(10)
        else:
            sys.exit('The public callback is unavailable or differs from the reviewed build.')
    print('Project callback is available and matches the reviewed page.')
