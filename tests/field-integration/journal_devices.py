"""Drive two separately installed Android packages against a disposable Supabase project."""
import subprocess
import time
import registration as ui

FIRST = 'app.anglers.journal.preview'
SECOND = 'app.anglers.journal'


def sign_in(package, identity, fresh=False):
    if fresh:
        assert ui.shell('pm', 'clear', package).strip() == 'Success'
    else:
        ui.shell('am', 'force-stop', package)
    ui.shell('pm', 'grant', package, 'android.permission.POST_NOTIFICATIONS')
    ui.shell('am', 'start', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '-p', package)
    # The sign-in screen may already contain an email after a cold restart.
    if fresh:
        ui.enter('account.email', identity[0])
    ui.enter('account.password', identity[1])
    ui.tap('common.sign_in', 'android.widget.Button')


def notification(package, expected):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if (f'|{package}|4816|' in ui.shell('cmd', 'notification', 'list')) == expected:
            return
        time.sleep(.25)
    raise AssertionError('Licence notification did not match the renewed expiry')


def verify_installations(stage, owner, other):
    def run(package, action):
        subprocess.run(['node', 'tests/field-integration/journal-device.mjs',
                        package, action, str(stage)], check=True, timeout=150)
    ui.shell('pm', 'grant', FIRST, 'android.permission.POST_NOTIFICATIONS')
    run(FIRST, 'seed')
    notification(FIRST, True)
    # Upgrade the installed local-only journal in place, preserving IndexedDB and account settings.
    sign_in(SECOND, owner, fresh=True)
    run(SECOND, 'legacy')
    ui.adb('install', '-r', str(stage / 'client/build/standalone/angler-journal-debug.apk'))
    sign_in(SECOND, owner)
    run(SECOND, 'consent')
    sign_in(SECOND, other, fresh=True)
    run(SECOND, 'isolation')
    sign_in(SECOND, owner, fresh=True)
    run(SECOND, 'restore')
    notification(SECOND, True)
    run(SECOND, 'renew')
    notification(SECOND, False)
    sign_in(FIRST, owner)
    run(FIRST, 'resolve')
    notification(FIRST, False)
    print('Two independent Android installations verified offline save, retry, exact photo restore, '
          'upgrade consent, conflict resolution, account isolation and licence renewal.', flush=True)
