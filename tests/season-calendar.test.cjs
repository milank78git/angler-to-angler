const test = require('node:test');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

test('Android season alarms use local time and recover same-day transitions and expiry', () => {
  const classes = mkdtempSync(join(tmpdir(), 'angler-calendar-'));
  try {
    execFileSync('java', [
      '-m',
      'jdk.compiler/com.sun.tools.javac.Main',
      '-d',
      classes,
      'app/src/main/java/app/anglers/journal/SeasonCalendar.java',
      'tests/SeasonCalendarTest.java',
    ]);
    execFileSync('java', ['-cp', classes, 'app.anglers.journal.SeasonCalendarTest']);
  } finally {
    rmSync(classes, { recursive: true, force: true });
  }
});
