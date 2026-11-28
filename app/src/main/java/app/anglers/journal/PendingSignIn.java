package app.anglers.journal;

import android.content.SharedPreferences;
import java.util.concurrent.TimeUnit;

/** Stores and expires the email or provider challenge across activity and process restarts. */
final class PendingSignIn {
  /** Keep all pending verifier state in the supplied private preferences. */
  private PendingSignIn() {}

  /** Commit the verifier and return destination together before leaving the app for verification. */
  static boolean save(SharedPreferences pending, String verifier, String address, String purpose,
      boolean groupLogin, boolean profileLogin) {
    boolean previouslyAccepted =
        verifier.equals(pending.getString("pkce", ""))
            && pending.getBoolean("pkceMailAccepted", true);
    return pending
            .edit()
            .putBoolean("pkceForGroups", groupLogin)
            .putBoolean("pkceForProfile", profileLogin)
            .putString("pkce", verifier)
            .putString("pkcePurpose", purpose)
            .putBoolean("pkceMailAccepted", previouslyAccepted)
            .putString("pkceEmail", address)
            .putLong("pkceAt", System.currentTimeMillis())
            .commit();
  }

  /** Remove the verifier and all metadata associated with the pending sign-in. */
  static void clear(SharedPreferences pending) {
    pending
        .edit()
        .remove("pkceForGroups")
        .remove("pkceForProfile")
        .remove("pkce")
        .remove("pkcePurpose")
        .remove("pkceMailAccepted")
        .remove("pkceAt")
        .remove("pkceEmail")
        .apply();
  }

  /** Apply the separate validity windows for browser sign-in and email confirmation. */
  static boolean fresh(SharedPreferences pending) {
    long age = System.currentTimeMillis() - pending.getLong("pkceAt", 0);
    long limit =
        pending.getString("pkceEmail", "").isEmpty()
            ? TimeUnit.MINUTES.toMillis(10)
            : TimeUnit.DAYS.toMillis(1);
    return pending.contains("pkce") && age >= 0 && age <= limit;
  }
}
