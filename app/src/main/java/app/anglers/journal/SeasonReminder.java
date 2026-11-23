package app.anglers.journal;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.time.Instant;
import java.time.LocalDate;
import java.time.MonthDay;
import java.time.ZoneId;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Reschedules opt-in seasonal transitions and the review date of a finite regional pack. */
public final class SeasonReminder extends BroadcastReceiver {
  private static final String FIRE = "app.anglers.journal.SEASON";
  private static final String CHANNEL = "fishing-seasons";

  private static SharedPreferences prefs(Context c) {
    return c.getSharedPreferences("season-watches", 0);
  }

  static void clearSubscriptions(Context c) {
    for (String key : prefs(c).getAll().keySet()) cancel(c, key);
    c.getSystemService(NotificationManager.class).cancelAll();
  }

  static boolean watching(Context c, String key) {
    return prefs(c).contains(key);
  }

  private static PendingIntent alarm(Context c, String key, long stamp) {
    Intent i =
        new Intent(c, SeasonReminder.class)
            .setAction(FIRE)
            .setData(Uri.parse("angler:season/" + Uri.encode(key)))
            .putExtra("key", key)
            .putExtra("due", stamp);
    return PendingIntent.getBroadcast(
        c, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
  }

  static boolean notificationsEnabled(Context context) {
    NotificationManager manager = context.getSystemService(NotificationManager.class);
    NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
    return manager.areNotificationsEnabled()
        && (channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE);
  }

  private static void cancel(Context context, String key) {
    prefs(context).edit().remove(key).apply();
    context.getSystemService(AlarmManager.class).cancel(alarm(context, key, 0));
  }

  static void toggle(Context context, String key, boolean enabled) {
    if (key == null
        || key.length() > 200
        || !key.matches("[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+")) return;
    if (!enabled) {
      cancel(context, key);
      return;
    }
    try {
      refresh(context, catalog(context), key, 0, Instant.now());
    } catch (Exception e) {
      android.util.Log.e("SeasonReminder", "Could not enable reminder", e);
    }
  }

  @Override
  public void onReceive(Context context, Intent intent) {
    try {
      if (AccountStore.remainingMillis(context) == 0) return;
      JSONObject pack = catalog(context);
      Instant now = Instant.now();
      if (FIRE.equals(intent.getAction())) {
        String key = intent.getStringExtra("key");
        long due = intent.getLongExtra("due", 0);
        if (key != null && due > 0 && prefs(context).getLong(key, 0) == due)
          refresh(context, pack, key, due, now);
        return;
      }
      for (Map.Entry<String, ?> watch : prefs(context).getAll().entrySet()) {
        if (watch.getValue() instanceof Long)
          refresh(context, pack, watch.getKey(), (Long) watch.getValue(), now);
      }
    } catch (Exception e) {
      android.util.Log.e("SeasonReminder", "Could not restore the reminder schedule", e);
    }
  }

  private static JSONObject catalog(Context c) throws Exception {
    try (BufferedReader r =
        new BufferedReader(new InputStreamReader(c.getAssets().open("catalog.json"), "UTF-8"))) {
      StringBuilder json = new StringBuilder();
      String line;
      while ((line = r.readLine()) != null) json.append(line);
      return new JSONObject(json.toString());
    }
  }

  /** Reconcile one persisted subscription against the currently installed pack. */
  private static void refresh(Context c, JSONObject pack, String key, long previousDue, Instant now)
      throws org.json.JSONException {
    String[] parts = key.split("/");
    JSONObject fish = null, water = null;
    if (parts.length == 3 && pack.getString("id").equals(parts[0])) {
      fish = pack.getJSONObject("species").optJSONObject(parts[2]);
      JSONArray waters = pack.getJSONArray("waters");
      for (int i = 0; i < waters.length(); i++) {
        JSONObject candidate = waters.getJSONObject(i);
        if (parts[1].equals(candidate.getString("id"))) {
          water = candidate;
          break;
        }
      }
    }
    if (water == null || fish == null) {
      cancel(c, key);
      return;
    }
    JSONArray bounds = fish.getJSONArray("window");
    SeasonCalendar calendar =
        new SeasonCalendar(
            ZoneId.of(pack.getString("zone")),
            LocalDate.parse(pack.getString("from")),
            LocalDate.parse(pack.getString("until")),
            MonthDay.parse("--" + bounds.getString(0)),
            MonthDay.parse("--" + bounds.getString(1)));
    SeasonCalendar.Event event = calendar.dueToday(previousDue, now);
    Instant next = calendar.next(now);
    if (next == null) cancel(c, key);
    else {
      long stamp = next.toEpochMilli();
      c.getSystemService(AlarmManager.class)
          .setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, stamp, alarm(c, key, stamp));
      prefs(c).edit().putLong(key, stamp).apply();
    }
    if (event != null && notificationsEnabled(c)) {
      String lang = c.getResources().getConfiguration().getLocales().get(0).getLanguage();
      String name = fish.getString("cs".equals(lang) ? "cs" : "en");
      int message =
          event == SeasonCalendar.Event.EXPIRES
              ? R.string.pack_expired
              : event == SeasonCalendar.Event.CLOSES
                  ? R.string.season_begins
                  : R.string.season_ends;
      post(c, key, water.getString("name") + " · " + name, c.getString(message));
    }
  }

  private static void post(Context c, String key, String title, String body) {
    NotificationManager manager = c.getSystemService(NotificationManager.class);
    manager.createNotificationChannel(
        new NotificationChannel(
            CHANNEL, c.getString(R.string.season), NotificationManager.IMPORTANCE_DEFAULT));
    Intent open = new Intent(c, AccountActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
    PendingIntent target =
        PendingIntent.getActivity(
            c, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    manager.notify(
        key,
        1,
        new Notification.Builder(c, CHANNEL)
            .setSmallIcon(R.drawable.notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setContentIntent(target)
            .setAutoCancel(true)
            .build());
  }
}
