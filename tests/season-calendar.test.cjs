const test = require('node:test');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

test('Android reminders handle seasonal transitions, licence expiry and calendar-month boundaries', () => {
  const classes = mkdtempSync(join(tmpdir(), 'angler-calendar-'));
  try {
    execFileSync('java', [
      '-m',
      'jdk.compiler/com.sun.tools.javac.Main',
      '-d',
      classes,
      'app/src/main/java/app/anglers/journal/SeasonCalendar.java',
      'tests/SeasonCalendarTest.java',
      'app/src/main/java/app/anglers/journal/LicenseCalendar.java',
      'tests/LicenseCalendarTest.java',
    ]);
    execFileSync('java', ['-cp', classes, 'app.anglers.journal.SeasonCalendarTest']);
    execFileSync('java', ['-cp', classes, 'app.anglers.journal.LicenseCalendarTest']);
  } finally {
    rmSync(classes, { recursive: true, force: true });
  }
});
