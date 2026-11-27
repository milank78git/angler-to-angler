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
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;

/** Schedules the next reminder without storing catch names, locations or photographs. */
public final class PhotoExpiryReminder extends BroadcastReceiver {
  private static final int ID = 4817;
  private static final int[] LEAD_DAYS = {30, 7};
  private static final String CHANNEL = "journal-photo-expiry";

  private static SharedPreferences preferences(Context context) {
    return context.getSharedPreferences(CHANNEL, Context.MODE_PRIVATE);
  }

  private static PendingIntent alarm(Context context) {
    return PendingIntent.getBroadcast(context, ID, new Intent(context, PhotoExpiryReminder.class),
        PendingIntent.FLAG_IMMUTABLE);
  }

  static synchronized void clear(Context context) {
    preferences(context).edit().clear().apply();
    context.getSystemService(AlarmManager.class).cancel(alarm(context));
    context.getSystemService(NotificationManager.class).cancel(ID);
  }

  /** Replace the schedule only when the WebView still belongs to the signed-in owner. */
  static synchronized void remember(Context context, String owner, String dates) {
    if (!owner.equals(AccountStore.prefs(context).getString("subject", "")) ||
        dates == null || dates.length() > 20000) return;
    Set<String> valid = new HashSet<>();
    try {
      JSONArray source = new JSONArray(dates);
      for (int i = 0; i < source.length(); i++) valid.add(LocalDate.parse(source.getString(i)).toString());
    } catch (Exception invalid) {
      return;
    }
    if (valid.isEmpty()) {
      clear(context);
      return;
    }
    SharedPreferences prefs = preferences(context);
    if (!owner.equals(prefs.getString("owner", ""))) clear(context);
    prefs.edit().putString("owner", owner).putStringSet("dates", valid).apply();
    reconcile(context);
  }

  private static boolean notifyOwner(Context context, String owner) {
    NotificationManager manager = context.getSystemService(NotificationManager.class);
    String title = AppLanguage.text(context, "retention.title");
    manager.createNotificationChannel(new NotificationChannel(CHANNEL, title, NotificationManager.IMPORTANCE_DEFAULT));
    if (!manager.areNotificationsEnabled() ||
        manager.getNotificationChannel(CHANNEL).getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
    Intent open = new Intent(context, AccountActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
        .putExtra("fieldAlert", "photoExpiry").putExtra("fieldOwner", owner);
    PendingIntent target = PendingIntent.getActivity(context, ID, open,
        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    manager.notify(ID, new Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.notification)
        .setContentTitle(title).setContentText(AppLanguage.text(context, "retention.notice"))
        .setContentIntent(target).setVisibility(Notification.VISIBILITY_PRIVATE).setAutoCancel(true).build());
    return true;
  }

  /** Coalesce due dates and re-arm after reboot, clock changes or a newly synchronized lease. */
  static synchronized void reconcile(Context context) {
    SharedPreferences prefs = preferences(context);
    String owner = prefs.getString("owner", "");
    if (owner.isEmpty() || !owner.equals(AccountStore.prefs(context).getString("subject", ""))) {
      clear(context);
      return;
    }
    LocalDate today = LocalDate.now(), next = null;
    Set<String> sent = prefs.getStringSet("sent", Collections.emptySet());
    Set<String> retained = new HashSet<>(), due = new HashSet<>();
    for (String value : prefs.getStringSet("dates", Collections.emptySet())) {
      LocalDate end = LocalDate.parse(value);
      if (!today.isBefore(end)) continue;
      for (int days : LEAD_DAYS) {
        LocalDate when = end.minusDays(days);
        String key = value + "/" + days;
        if (sent.contains(key)) retained.add(key);
        else if (!when.isAfter(today)) due.add(key);
        else if (next == null || when.isBefore(next)) next = when;
      }
    }
    AlarmManager alarms = context.getSystemService(AlarmManager.class);
    alarms.cancel(alarm(context));
    if (!due.isEmpty() && notifyOwner(context, owner)) retained.addAll(due);
    if (retained.isEmpty()) context.getSystemService(NotificationManager.class).cancel(ID);
    prefs.edit().putStringSet("sent", retained).apply();
    if (next != null) {
      long wakeAt = next.atTime(8, 0).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
      alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, wakeAt, alarm(context));
    }
  }

  @Override public void onReceive(Context context, Intent event) {
    reconcile(context);
  }
}
