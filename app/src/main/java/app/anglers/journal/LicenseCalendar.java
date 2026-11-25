package app.anglers.journal;

import java.time.LocalDate;

/** Calendar dates follow the current device zone. A ticket remains valid through its expiry day. */
final class LicenseCalendar {
  static LocalDate starts(LocalDate expiry, String reminder) {
    if ("month".equals(reminder)) return expiry.minusMonths(1);
    if ("week".equals(reminder)) return expiry.minusWeeks(1);
    return null;
  }

  static String notice(LocalDate expiry, String reminder, LocalDate today) {
    LocalDate start = starts(expiry, reminder);
    if (start == null || today.isBefore(start)) return "";
    if (today.isAfter(expiry)) return "expired";
    return today.equals(expiry) ? "today" : "soon";
  }

  private LicenseCalendar() {}
}
