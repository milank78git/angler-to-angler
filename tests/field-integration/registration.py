"""Register using the installed APK, the real email, PKCE and the deployed profile RPC."""
import html
import json
import re
import secrets
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

package = 'app.anglers.journal.preview'
callback = 'https://horistum.com/account/' + package + '/callback'
labels = json.loads(Path('app/src/main/assets/strings-en.json').read_text())
address = 'field-' + secrets.token_hex(5) + '@example.test'
def adb(*args):
    result=subprocess.run(['adb',*args],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
    if result.returncode:
        raise RuntimeError('ADB operation failed; arguments suppressed')
    return result.stdout.decode()
def shell(*args):
    return adb('shell',*args)
def tap(label=None, field=None):
    for attempt in range(15):
        shell('uiautomator','dump','/sdcard/field-window.xml')
        raw=adb('exec-out','cat','/sdcard/field-window.xml')
        for node in ET.fromstring(raw).iter('node'):
            a=node.attrib
            if labels[label] not in (a.get('text'),a.get('hint'),a.get('content-desc')) or (field and a.get('class')!=field):
                continue
            x,y,right,bottom=map(int,re.findall(r'\d+',a['bounds']))
            shell('input','tap',str((x+right)//2),str((y+bottom)//2))
            return
        time.sleep(.25)
    raise RuntimeError('Android control unavailable: '+label)
def enter(label,value):
    tap(label,'android.widget.EditText')
    shell('input','text',value)
    shell('input','keyevent','111')
def mailbox(path):
    with urllib.request.urlopen('http://127.0.0.1:54324/api/v1/'+path,timeout=5) as r:
        return json.load(r)
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args):
        return None

shell('am','start','-n',package+'/app.anglers.journal.AccountActivity')
tap('account.create_account')
enter('account.email',address)
enter('account.new_password',secrets.token_hex(12)+'Aa1')
tap('account.register')
print('Signup submitted; waiting for the test mailbox.',flush=True)
for attempt in range(30):
    messages=mailbox('messages').get('messages',[])
    message=next((m for m in messages if any(t['Address']==address for t in m['To'])),None)
    if message:
        break
    time.sleep(1)
else:
    raise RuntimeError('The test inbox did not receive confirmation')
body=mailbox('message/'+message['ID'])['HTML']
link=html.unescape(re.search(r'href=["\']([^"\']+/verify\?[^"\']+)["\']',body).group(1))
parts=urllib.parse.urlsplit(link)
assert parts.hostname in ('127.0.0.1','localhost') and parts.port==54321
assert urllib.parse.parse_qs(parts.query)['redirect_to']==[callback]
try:
    urllib.request.build_opener(NoRedirect()).open(link)
    raise RuntimeError('Expected an Auth redirect')
except urllib.error.HTTPError as e:
    target=e.headers['Location']
    assert e.code in (302,303) and urllib.parse.urlsplit(target)._replace(query='',fragment='').geturl()==callback
assert 'code' in urllib.parse.parse_qs(urllib.parse.urlsplit(target).query)
print('Email verified; opening the installed APK.',flush=True)
# A package-scoped web intent exercises the actual filter without associating the public domain with a test certificate.
shell('am','force-stop',package)
shell('am','start','-a','android.intent.action.VIEW','-c','android.intent.category.BROWSABLE','-p',package,'-d',target)
enter('account.display_name_2_60_characters','FieldAngler')
tap('account.i_accept_the_terms_of_use')
tap('account.i_acknowledge_the_privacy_notice')
tap('common.save_profile')
for attempt in range(25):
    if any('FishingActivity' in line for line in shell('dumpsys','activity','activities').splitlines() if 'topResumedActivity' in line or 'mResumedActivity' in line):
        break
    time.sleep(1)
else:
    raise RuntimeError('Profile saved but journal activity did not open')
print('APK signup, SMTP delivery, cold-start HTTPS callback, PKCE and profile creation passed.')
