package app.anglers.journal;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.MonthDay;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

/** Calculates local season transitions and the regional pack expiry notice at 08:00. */
final class SeasonCalendar {
  enum Event {
    CLOSES,
    OPENS,
    EXPIRES
  }

  /** One inclusive interval published by the fishery authority for the selected species. */
  static final class Period {
    final LocalDate from, until;
    final boolean closed;

    /** Record one published closure or opening with inclusive validity dates. */
    Period(LocalDate from, LocalDate until, boolean closed) {
      this.from = from;
      this.until = until;
      this.closed = closed;
    }
  }

  final ZoneId zone;
  private LocalDate observedFrom;
  private final List<Period> periods = new ArrayList<>();
  private final LocalDate from, until;
  private final MonthDay first, last;

  /** Associate recurring rules and their validity range with the fishing water's zone. */
  SeasonCalendar(ZoneId zone, LocalDate from, LocalDate until, MonthDay first, MonthDay last) {
    this.zone = zone;
    this.from = from;
    this.until = until;
    this.first = first;
    this.last = last;
  }

  /** Replace recurring rules with the available published periods from their effective date. */
  void useDatedRules(LocalDate since, List<Period> records) {
    observedFrom = since;
    periods.clear();
    periods.addAll(records);
  }

  /** Look up the closure for a date and preserve uncertainty outside verified coverage. */
  private Boolean closed(LocalDate date) {
    if (observedFrom != null && !date.isBefore(observedFrom)) {
      for (Period period : periods)
        if (!date.isBefore(period.from) && !date.isAfter(period.until)) return period.closed;
      return null;
    }
    if (date.isBefore(from) || date.isAfter(until)) return null;
    MonthDay day = MonthDay.from(date);
    return first.isAfter(last)
        ? !day.isBefore(first) || !day.isAfter(last)
        : !day.isBefore(first) && !day.isAfter(last);
  }

  /** Compare adjacent days to identify an opening, closure or end of verified coverage. */
  Event event(LocalDate day) {
    Boolean before = closed(day.minusDays(1)), after = closed(day);
    if (before == null || before.equals(after)) return null;
    if (after == null) return Event.EXPIRES;
    return after ? Event.CLOSES : Event.OPENS;
  }

  /** Find the next scheduled transition in the fishing water's time zone. */
  Instant next(Instant now) {
    LocalDate day = now.atZone(zone).toLocalDate(), expiry = until.plusDays(1);
    for (Period period : periods)
      if (!period.until.isBefore(expiry)) expiry = period.until.plusDays(1);
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
