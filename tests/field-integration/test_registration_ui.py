"""Verify Android UI reads can recover without repeating a user action or logging input."""
import io
import subprocess
import unittest
from unittest.mock import patch

import registration


class RegistrationWindowTest(unittest.TestCase):
    @patch('registration.time.sleep')
    @patch('registration.subprocess.run')
    def test_only_taps_once_after_a_transient_read_and_an_incomplete_window(self, run, _sleep):
        label = registration.LABELS['common.save_profile']
        window = f'<hierarchy><node text="{label}" enabled="true" clickable="true" bounds="[0,0][20,30]"/></hierarchy>'.encode()
        run.side_effect = [subprocess.TimeoutExpired('adb', 15),
                           subprocess.CompletedProcess([], 0, b'<hierarchy>'),
                           subprocess.CompletedProcess([], 0, window),
                           subprocess.CompletedProcess([], 0, b'')]
        with patch('sys.stderr', new_callable=io.StringIO):
            registration.tap('common.save_profile')
        commands = [call.args[0] for call in run.call_args_list]
        self.assertEqual([command[-1] for command in commands if 'input tap' in command[-1]],
                         ['input tap 10 15'])

    @patch('registration.time.sleep')
    @patch('registration.subprocess.run')
    def test_optional_control_requires_a_readable_window_and_keeps_output_private(self, run, _sleep):
        run.side_effect = subprocess.CalledProcessError(1, 'adb', stderr=b'private UI content')
        with patch('sys.stderr', new_callable=io.StringIO) as log:
            with self.assertRaisesRegex(RuntimeError, 'Android window could not be read'):
                registration.control('account.fresh_journal', optional=True)
        self.assertEqual(run.call_count, 3)
        self.assertIn('account.fresh_journal', log.getvalue())
        self.assertNotIn('private UI content', log.getvalue())

    @patch('registration.time.sleep')
    @patch('registration.subprocess.run')
    def test_absent_optional_control_can_be_skipped(self, run, _sleep):
        run.return_value = subprocess.CompletedProcess([], 0, b'<hierarchy/>')
        self.assertIsNone(registration.control('account.fresh_journal', optional=True))
