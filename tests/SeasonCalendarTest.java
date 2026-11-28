package app.anglers.journal;

import java.time.Instant;
import java.time.LocalDate;
import java.time.MonthDay;
import java.time.ZoneId;
import java.util.Objects;

/** Exercises the same scheduling policy used for alarms, boot and package replacement. */
public final class SeasonCalendarTest {
  private static void expect(Object expected, Object actual) {
    if (!Objects.equals(expected, actual))
      throw new AssertionError("Expected " + expected + " but got " + actual);
  }

  public static void main(String[] args) {
    alarmBoundaries();
    SeasonCalendar winter =
        new SeasonCalendar(
            ZoneId.of("Europe/Prague"),
            LocalDate.parse("2026-01-01"),
            LocalDate.parse("2026-12-31"),
            MonthDay.of(9, 1),
            MonthDay.of(4, 15));
    expect(null, winter.event(LocalDate.parse("2026-04-15")));
    expect(SeasonCalendar.Event.OPENS, winter.event(LocalDate.parse("2026-04-16")));
    expect(SeasonCalendar.Event.CLOSES, winter.event(LocalDate.parse("2026-09-01")));
    expect(
        Instant.parse("2026-04-16T06:00:00Z"), winter.next(Instant.parse("2026-03-01T12:00:00Z")));
    Instant alarm = Instant.parse("2027-01-01T07:00:00Z");
    expect(alarm, winter.next(alarm.minusSeconds(60)));
    expect(null, winter.next(alarm));
    expect(null, winter.dueToday(alarm.toEpochMilli(), alarm.minusSeconds(1)));
    expect(
        SeasonCalendar.Event.EXPIRES,
        winter.dueToday(alarm.toEpochMilli(), alarm.plusSeconds(300)));
    expect(null, winter.dueToday(alarm.toEpochMilli(), alarm.plusSeconds(86400)));
    expect(null, winter.dueToday(0, alarm));
    winter.useDatedRules(LocalDate.parse("2026-11-26"), java.util.Arrays.asList(
        new SeasonCalendar.Period(LocalDate.parse("2026-11-26"), LocalDate.parse("2026-12-31"), true),
        new SeasonCalendar.Period(LocalDate.parse("2027-01-01"), LocalDate.parse("2027-01-20"), false)));
    expect(SeasonCalendar.Event.OPENS, winter.event(LocalDate.parse("2027-01-01")));
    expect(null, winter.event(LocalDate.parse("2027-01-20")));
    expect(SeasonCalendar.Event.EXPIRES, winter.event(LocalDate.parse("2027-01-21")));
  }

  /** The same local alarm crosses different UTC dates and daylight-saving offsets in these regions. */
  private static void alarmBoundaries() {
    for (String name : new String[] {"Europe/Prague", "America/New_York", "Pacific/Auckland", "Asia/Kathmandu"}) {
      ZoneId zone = ZoneId.of(name);
      for (String first : new String[] {"2028-02-29", "2028-03-26", "2028-10-29", "2028-12-31"}) {
        LocalDate start = LocalDate.parse(first);
        SeasonCalendar calendar = new SeasonCalendar(zone, start.minusDays(1), start.plusDays(4),
            MonthDay.from(start), MonthDay.from(start.plusDays(1)));
        Instant close = start.atTime(8, 0).atZone(zone).toInstant();
        Instant open = start.plusDays(2).atTime(8, 0).atZone(zone).toInstant();
        expect(close, calendar.next(close.minusMillis(1)));
        expect(open, calendar.next(close));
        expect(null, calendar.dueToday(close.toEpochMilli(), close.minusMillis(1)));
        expect(SeasonCalendar.Event.CLOSES, calendar.dueToday(close.toEpochMilli(), close));
        expect(SeasonCalendar.Event.CLOSES, calendar.dueToday(close.toEpochMilli(), start.atTime(23, 59).atZone(zone).toInstant()));
        expect(null, calendar.dueToday(close.toEpochMilli(), start.plusDays(1).atStartOfDay(zone).toInstant()));
        expect(SeasonCalendar.Event.OPENS, calendar.dueToday(open.toEpochMilli(), open));
      }
    }
  }

}
