package app.anglers.journal;

import java.time.LocalDate;

/** Calendar dates follow the current device zone. A ticket remains valid through its expiry day. */
final class LicenseCalendar {
  /** Compute the first reminder date using calendar-month or calendar-week arithmetic. */
  static LocalDate starts(LocalDate expiry, String reminder) {
    if ("month".equals(reminder)) return expiry.minusMonths(1);
    if ("week".equals(reminder)) return expiry.minusWeeks(1);
    return null;
  }

  /** Classify the day against the inclusive validity period and configured lead time. */
  static String notice(LocalDate expiry, String reminder, LocalDate today) {
    LocalDate start = starts(expiry, reminder);
    if (start == null || today.isBefore(start)) return "";
    if (today.isAfter(expiry)) return "expired";
    return today.equals(expiry) ? "today" : "soon";
  }

  /** Keep the date-only reminder policy independent of activity state. */
  private LicenseCalendar() {}
}
