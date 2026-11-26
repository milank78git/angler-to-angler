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
}
