package app.anglers.journal;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.MonthDay;
import java.time.ZoneId;

/** Calculates local season transitions and the regional pack expiry notice at 08:00. */
final class SeasonCalendar {
  enum Event {
    CLOSES,
    OPENS,
    EXPIRES
  }

  final ZoneId zone;
  private final LocalDate from, until;
  private final MonthDay first, last;

  SeasonCalendar(ZoneId zone, LocalDate from, LocalDate until, MonthDay first, MonthDay last) {
    this.zone = zone;
    this.from = from;
    this.until = until;
    this.first = first;
    this.last = last;
  }

  private boolean closed(LocalDate date) {
    MonthDay day = MonthDay.from(date);
    return first.isAfter(last)
        ? !day.isBefore(first) || !day.isAfter(last)
        : !day.isBefore(first) && !day.isAfter(last);
  }

  Event event(LocalDate day) {
    if (day.equals(until.plusDays(1))) return Event.EXPIRES;
    if (!day.isAfter(from) || day.isAfter(until) || closed(day) == closed(day.minusDays(1)))
      return null;
    return closed(day) ? Event.CLOSES : Event.OPENS;
  }

  Instant next(Instant now) {
    LocalDate day = now.atZone(zone).toLocalDate(), expiry = until.plusDays(1);
    if (day.isBefore(from)) day = from;
    for (; !day.isAfter(expiry); day = day.plusDays(1)) {
      if (event(day) != null) {
        Instant due = day.atTime(LocalTime.of(8, 0)).atZone(zone).toInstant();
        if (due.isAfter(now)) return due;
      }
    }
    return null;
  }

  /**
   * After a reboot, deliver a missed alarm only on its own day and under the current pack rules.
   */
  Event dueToday(long due, Instant now) {
    if (due <= 0 || due > now.toEpochMilli()) return null;
    LocalDate today = now.atZone(zone).toLocalDate();
    return today.equals(Instant.ofEpochMilli(due).atZone(zone).toLocalDate()) ? event(today) : null;
  }
}
