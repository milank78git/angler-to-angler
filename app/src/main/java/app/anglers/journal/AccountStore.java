package app.anglers.journal;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * Stores the identity confirmed by the profile service for bounded offline use. No OAuth tokens are
 * persisted.
 */
final class AccountStore {
  static final String REVISION = "2026-11-23";
  private static final long WINDOW = TimeUnit.DAYS.toMillis(7);

  static SharedPreferences prefs(Context c) {
    return c.getSharedPreferences("angler-account", Context.MODE_PRIVATE);
  }

  static String active(Context c) {
    SharedPreferences p = prefs(c);
    return remainingMillis(c) > 0 ? p.getString("subject", "") : "";
  }

  static long remainingMillis(Context c) {
    SharedPreferences p = prefs(c);
    long age = System.currentTimeMillis() - p.getLong("verified", 0);
    if (age < 0 || age >= WINDOW || !REVISION.equals(p.getString("revision", ""))) return 0;
    return WINDOW - age;
  }

  static void activate(Context c, String id, String name, boolean claimLegacy) {
    String subject = UUID.fromString(id).toString();
    SharedPreferences p = prefs(c);
    if (!subject.equals(p.getString("subject", ""))) SeasonReminder.clearSubscriptions(c);
    SharedPreferences.Editor edit =
        p.edit()
            .putString("subject", subject)
            .putString("name", name)
            .putString("revision", REVISION)
            .putLong("verified", System.currentTimeMillis());
    if (!p.contains("legacyOwner")) edit.putString("legacyOwner", claimLegacy ? subject : "");
    edit.apply();
  }

  static String journal(Context c) {
    String id = active(c);
    if (id.isEmpty()) throw new IllegalStateException("Profile required");
    return id.equals(prefs(c).getString("legacyOwner", ""))
        ? "angler-field-journal"
        : "angler-field-journal-" + id;
  }

  static void logout(Context c) {
    prefs(c).edit().remove("subject").remove("name").remove("verified").remove("revision").apply();
    SeasonReminder.clearSubscriptions(c);
  }
}
