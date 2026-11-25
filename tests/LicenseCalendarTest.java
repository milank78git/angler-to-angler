package app.anglers.journal;

import java.time.LocalDate;
import java.util.Objects;

final class LicenseCalendarTest {
  static void expect(Object expected, Object actual) {
    if (!Objects.equals(expected, actual)) throw new AssertionError("Expected "+expected+", received "+actual);
  }

  public static void main(String[] args) {
    LocalDate expiry = LocalDate.parse("2028-03-31");
    expect(LocalDate.parse("2028-02-29"), LicenseCalendar.starts(expiry,"month"));
    expect(LocalDate.parse("2027-02-28"), LicenseCalendar.starts(expiry.minusYears(1),"month"));
    expect(LocalDate.parse("2025-12-28"), LicenseCalendar.starts(LocalDate.parse("2026-01-04"),"week"));
    expect("", LicenseCalendar.notice(expiry,"week",expiry.minusDays(8)));
    expect("soon", LicenseCalendar.notice(expiry,"week",expiry.minusDays(7)));
    expect("today", LicenseCalendar.notice(expiry,"week",expiry));
    expect("expired", LicenseCalendar.notice(expiry,"week",expiry.plusDays(1)));
    expect("", LicenseCalendar.notice(expiry,"off",expiry));
  }
}
