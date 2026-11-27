package app.anglers.journal;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.File;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/** Keeps a verified offline lease and a device-authenticated refresh credential for one profile. */
final class AccountStore {
  static final String REVISION = "2026-11-26.2";
  private static final long WINDOW = TimeUnit.DAYS.toMillis(7);
  private static final Object REFRESH_LOCK = new Object();
  private static IdentityService.Session session;
  private static long generation;

  static SharedPreferences prefs(Context c) {
    return c.getSharedPreferences("angler-account", Context.MODE_PRIVATE);
  }

  /**
   * Record an empty installation before sign-in help can initialize WebView storage. Existing
   * installations with possible pre-account journals still ask the first verified user to claim it.
   */
  static void initializeJournalOwnership(Context c) {
    SharedPreferences account = prefs(c);
    if (!account.contains("legacyOwner") && !new File(c.getApplicationInfo().dataDir, "app_webview").exists()) {
      account.edit().putString("legacyOwner", "").apply();
    }
  }

  static synchronized void lock() {
    session = null;
  }

  static synchronized String active(Context c) {
    return session != null
            && session.id.equals(prefs(c).getString("subject", ""))
            && remainingMillis(c) > 0
        ? session.id
        : "";
  }

  static boolean canShareOutsideGroups(Context c) {
    String band = active(c).isEmpty() ? "" : prefs(c).getString("ageBand", "");
    return "adult".equals(band) || "teen".equals(band);
  }

  static long remainingMillis(Context c) {
    SharedPreferences p = prefs(c);
    long age = System.currentTimeMillis() - p.getLong("verified", 0);
    if (age < 0
        || age >= WINDOW
        || !p.contains("subject")
        || !REVISION.equals(p.getString("revision", ""))) return 0;
    return WINDOW - age;
  }

  private static void persist(Context c, IdentityService.Session value) {
    try {
      DeviceVault.save(c, value);
    } catch (Exception unavailable) {
      DeviceVault.clear(c);
    } // Password sign-in still works.
  }

  static synchronized IdentityService.Session unlock(Context c) throws Exception {
    session = DeviceVault.open(c);
    return session;
  }

  /** Called only after Auth and the profile RPC agree on identity and legal revisions. */
  static synchronized void activate(
      Context c, String name, String ageBand, boolean claimLegacy, IdentityService.Session value) {
    SharedPreferences p = prefs(c);
    if (!value.id.equals(p.getString("subject", ""))) {
      LicenseReminder.clear(c);
      SeasonReminder.clearSubscriptions(c);
      FieldAlerts.clear(c);
      DeviceVault.clear(c);
    }
    if (!value.id.equals(p.getString("subject", "")) ||
        !("adult".equals(ageBand) || "teen".equals(ageBand))) PhotoExpiryReminder.clear(c);
    SharedPreferences.Editor edit =
        p.edit()
            .putString("subject", value.id)
            .putString("name", name)
            .putString("ageBand", ageBand)
            .putString("email", value.email)
            .putString("revision", REVISION)
            .putLong("verified", System.currentTimeMillis());
    if (!p.contains("legacyOwner")) edit.putString("legacyOwner", claimLegacy ? value.id : "");
    edit.apply();
    generation++;
    session = value;
    persist(c, value);
  }

  /** Coalesce concurrent refreshes, including the single retry after an API rejects a bearer. */
  static IdentityService.Session online(
      Context c, IdentityService service, String id, IdentityService.Session rejected)
      throws Exception {
    synchronized (REFRESH_LOCK) {
      IdentityService.Session current;
      long owner;
      synchronized (AccountStore.class) {
        current = session;
        owner = generation;
        if (current == null || !current.id.equals(id) || current.refresh.isEmpty())
          throw new IdentityService.HttpFailure(401);
        if (current != rejected
            && !current.access.isEmpty()
            && current.expires - System.currentTimeMillis() > 30000) return current;
      }
      IdentityService.Session next;
      try {
        next = service.refresh(current);
      } catch (IdentityService.HttpFailure err) {
        if (err.status != 400 && err.status != 401 && err.status != 403) throw err;
        synchronized (AccountStore.class) {
          if (owner == generation) {
            DeviceVault.clear(c);
            if (session == current)
              session = new IdentityService.Session(id, current.email, "", "", 0);
          }
        }
        throw new IdentityService.HttpFailure(401);
      }
      synchronized (AccountStore.class) {
        if (owner != generation) throw new IdentityService.HttpFailure(401);
        persist(c, next);
        if (session != current) throw new IdentityService.HttpFailure(401);
        session = next;
        return next;
      }
    }
  }

  static JSONObject rpc(
      Context c, IdentityService service, String id, String method, JSONObject args)
      throws Exception {
    if (id.isEmpty() || !id.equals(active(c))) throw new IdentityService.HttpFailure(401);
    IdentityService.Session auth = online(c, service, id, null);
    try {
      return service.rpc(method, auth.access, args);
    } catch (IdentityService.HttpFailure err) {
      if (err.status != 401) throw err;
      return service.rpc(method, online(c, service, id, auth).access, args);
    }
  }

  /** Refresh the lease only after the server confirms identity, age band and current terms. */
  static void renewLease(Context c, String id) throws Exception {
    final long owner;
    synchronized (AccountStore.class) {
      owner = generation;
      if (!id.equals(active(c))) return;
    }
    IdentityService service = new IdentityService(c);
    IdentityService.Session credential = online(c, service, id, null);
    JSONObject profile = service.profile(credential.access);
    synchronized (AccountStore.class) {
      if (owner != generation || session == null || !session.id.equals(id)) return;
      boolean valid = profile != null && id.equals(profile.optString("id")) && profile.optBoolean("current")
          && prefs(c).getString("ageBand", "").equals(profile.optString("ageBand"));
      prefs(c).edit().putLong("verified", valid ? System.currentTimeMillis() : 0).apply();
    }
  }

  static String journal(Context c) {
    String id = active(c);
    if (id.isEmpty()) throw new IllegalStateException("Profile required");
    return id.equals(prefs(c).getString("legacyOwner", ""))
        ? "angler-field-journal"
        : "angler-field-journal-" + id;
  }

  static synchronized IdentityService.Session logout(Context c) {
    IdentityService.Session previous = session;
    generation++;
    session = null;
    DeviceVault.clear(c);
    prefs(c)
        .edit()
        .remove("subject")
        .remove("email")
        .remove("name")
        .remove("verified")
        .remove("revision")
        .apply();
    LicenseReminder.clear(c);
    PhotoExpiryReminder.clear(c);
    SeasonReminder.clearSubscriptions(c);
    FieldAlerts.clear(c);
    return previous;
  }
}
