"""Check both email confirmation paths with an installed APK and a disposable SMTP inbox."""
import html
import json
import os
import re
import secrets
import shlex
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

PACKAGE = 'app.anglers.journal.preview'
HOST = 'horistum.com'
CALLBACK = f'https://{HOST}/account/{PACKAGE}/callback'
LABELS = json.loads(Path('app/src/main/assets/strings-en.json').read_text())


def adb(*args):
    result = subprocess.run(['adb', *args], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    if result.returncode:
        raise RuntimeError('ADB operation failed; arguments suppressed')
    return result.stdout.decode()


def shell(*args):
    return adb('shell', shlex.join(args))


def control(key, field=None, optional=False):
    for _ in range(2 if optional else 15):
        shell('uiautomator', 'dump', '/sdcard/field-window.xml')
        raw = adb('exec-out', 'cat', '/sdcard/field-window.xml')
        for node in ET.fromstring(raw).iter('node'):
            attrs = node.attrib
            if (LABELS[key] in (attrs.get('text'), attrs.get('hint'), attrs.get('content-desc'))
                    and (field is None or attrs.get('class') == field)):
                return attrs
        time.sleep(.25)
    if not optional:
        raise RuntimeError('Android control unavailable: ' + key)


def tap(key, field=None, optional=False):
    attrs = control(key, field, optional)
    if attrs:
        x, y, right, bottom = map(int, re.findall(r'\d+', attrs['bounds']))
        shell('input', 'tap', str((x+right)//2), str((y+bottom)//2))


def enter(key, value):
    tap(key, 'android.widget.EditText')
    shell('input', 'text', value)
    shell('input', 'keyevent', '111')


def mailbox(path):
    with urllib.request.urlopen('http://127.0.0.1:54324/api/v1/' + path, timeout=5) as response:
        return json.load(response)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def confirm_in_mailbox(address):
    for _ in range(30):
        messages = mailbox('messages').get('messages', [])
        message = next((m for m in messages if any(t['Address'] == address for t in m['To'])), None)
        if message:
            break
        time.sleep(1)
    else:
        raise RuntimeError('The test inbox did not receive confirmation')
    body = mailbox('message/' + message['ID'])['HTML']
    mail_labels = json.loads(Path('supabase/templates/en.json').read_text())
    assert mail_labels['confirmation.instruction'] in html.unescape(body), 'Wrong confirmation template or language'
    link = html.unescape(re.search(r'href=["\']([^"\']+/verify\?[^"\']+)["\']', body).group(1))
    parts = urllib.parse.urlsplit(link)
    assert parts.hostname in ('127.0.0.1', 'localhost') and parts.port == 54321
    assert urllib.parse.parse_qs(parts.query)['redirect_to'] == [CALLBACK]
    try:
        urllib.request.build_opener(NoRedirect()).open(link)
        raise RuntimeError('Expected an Auth redirect')
    except urllib.error.HTTPError as err:
        target = err.headers['Location']
        assert err.code in (302, 303)
    parts = urllib.parse.urlsplit(target)
    assert parts._replace(query='', fragment='').geturl() == CALLBACK
    assert urllib.parse.parse_qs(parts.query).get('code')
    return target


def register():
    address = 'field-' + secrets.token_hex(5) + '@example.test'
    password = secrets.token_hex(12) + 'Aa1'
    shell('am', 'start', '-n', PACKAGE + '/app.anglers.journal.AccountActivity')
    tap('account.create_account')
    enter('account.email', address)
    enter('account.new_password', password)
    tap('account.register')
    control('account.open_inbox')
    return address, password


def complete_profile():
    enter('account.display_name_2_60_characters', 'FieldAngler')
    tap('account.i_accept_the_terms_of_use')
    tap('account.i_acknowledge_the_privacy_notice')
    tap('common.save_profile')
    tap('account.fresh_journal', optional=True)
    for _ in range(25):
        state = shell('dumpsys', 'activity', 'activities').splitlines()
        if any('FishingActivity' in line for line in state
               if 'topResumedActivity' in line or 'mResumedActivity' in line):
            return
        time.sleep(1)
    raise RuntimeError('Profile saved but journal activity did not open')


def phone_confirmation():
    address, password = register()
    target = confirm_in_mailbox(address)
    # The emulator user chooses this preview for the domain. The public site uses the pilot certificate.
    shell('pm', 'set-app-links-user-selection', '--user', 'current', '--package', PACKAGE, 'true', HOST)
    intent = ('-a', 'android.intent.action.VIEW', '-c', 'android.intent.category.BROWSABLE', '-d')
    component = shell('cmd', 'package', 'resolve-activity', '--brief', *intent, CALLBACK)
    assert PACKAGE + '/' in component and 'AccountCallbackActivity' in component, 'App link did not resolve to preview'
    shell('am', 'force-stop', PACKAGE)
    shell('am', 'start', *intent, target)
    complete_profile()
    print('Phone: SMTP, system link selection, cold start, PKCE and profile creation passed.', flush=True)
    return address, password


def desktop_confirmation():
    # Remove the first synthetic account from this disposable installation only.
    assert shell('pm', 'clear', PACKAGE).strip() == 'Success'
    address, password = register()
    tap('account.confirmed_sign_in')
    enter('account.password', password)
    tap('common.sign_in')
    control('account.confirm_your_email_on_this_phone_first')
    tap('account.return_to_confirmation')
    confirm_in_mailbox(address)  # Another device consumes the email; Android receives no callback.
    shell('am', 'force-stop', PACKAGE)
    shell('am', 'start', '-n', PACKAGE + '/app.anglers.journal.AccountActivity')
    tap('account.confirmed_sign_in')
    enter('account.password', password)  # The registration address must already be filled in.
    tap('common.sign_in')
    complete_profile()
    matching = [m for m in mailbox('messages')['messages'] if any(t['Address'] == address for t in m['To'])]
    assert len(matching) == 1, 'Password continuation unexpectedly requested another email'
    print('Desktop: unconfirmed login rejected, original message confirmed, password and profile accepted.', flush=True)


address, password = phone_confirmation()
desktop_confirmation()
# The restore probe must find the original identity after the second account was created.
with os.fdopen(os.open(Path(sys.argv[1]) / 'test-identity.json',
                       os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as out:
    json.dump({'email': address, 'password': password}, out)
