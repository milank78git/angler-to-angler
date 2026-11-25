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
import java.time.format.DateTimeFormatter;
import java.time.format.FormatStyle;
import org.json.JSONObject;

/** One private alarm per installation. Only server-confirmed changes can update its calendar. */
public final class LicenseReminder extends BroadcastReceiver {
  static final String CHANNEL = "fishing-license";
  private static final String FIRE = "app.anglers.journal.LICENSE_DUE";
  private static final int ID = 4816;

  private static SharedPreferences prefs(Context c) {
    return c.getSharedPreferences("fishing-license", Context.MODE_PRIVATE);
  }

  private static PendingIntent alarm(Context c) {
    return PendingIntent.getBroadcast(c, ID, new Intent(c, LicenseReminder.class).setAction(FIRE),
        PendingIntent.FLAG_IMMUTABLE);
  }

  static synchronized void clear(Context c) {
    prefs(c).edit().clear().apply();
    c.getSystemService(AlarmManager.class).cancel(alarm(c));
    c.getSystemService(NotificationManager.class).cancel(ID);
  }

  static synchronized void remember(Context c, String subject, JSONObject saved) throws org.json.JSONException {
    if (!subject.equals(AccountStore.prefs(c).getString("subject",""))) return;
    SharedPreferences cache = prefs(c);
    int revision = saved.getInt("revision");
    if (revision < cache.getInt("revision", -1)) return;
    String date = saved.isNull("expiry") ? "" : saved.getString("expiry");
    String lead = saved.getString("reminder");
    boolean changed = !date.equals(cache.getString("date","")) || !lead.equals(cache.getString("lead","off"));
    SharedPreferences.Editor edit = cache.edit().putString("owner",subject).putInt("revision",revision)
        .putString("date",date).putString("lead",lead);
    if (changed) {
      edit.remove("delivered");
      c.getSystemService(NotificationManager.class).cancel(ID);
    }
    edit.apply();
    reconcile(c);
  }

  static boolean notificationsEnabled(Context c) {
    NotificationManager manager = c.getSystemService(NotificationManager.class);
    NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
    return manager.areNotificationsEnabled() && (channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE);
  }

  private static LocalDate expiry(Context c) {
    SharedPreferences cache = prefs(c);
    String owner = cache.getString("owner","");
    String date = cache.getString("date","");
    if (date.isEmpty() || !owner.equals(AccountStore.prefs(c).getString("subject",""))) return null;
    return LocalDate.parse(date);
  }

  /** The same window drives the offline in-app message and Android delivery. */
  static synchronized String message(Context c) {
    LocalDate date = expiry(c);
    if (date == null) return "";
    String state = LicenseCalendar.notice(date, prefs(c).getString("lead","off"), LocalDate.now());
    if (state.isEmpty()) return "";
    String formatted = date.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(AppLanguage.current(c)));
    return AppLanguage.text(c, "license."+state).replace("{date}",formatted);
  }

  static synchronized void reconcile(Context c) {
    SharedPreferences cache = prefs(c);
    AlarmManager alarms = c.getSystemService(AlarmManager.class);
    LocalDate date = expiry(c);
    LocalDate today = LocalDate.now();
    LocalDate start = date == null ? null : LicenseCalendar.starts(date,cache.getString("lead","off"));
    if (start == null || today.isAfter(date) || cache.getBoolean("delivered",false)) {
      alarms.cancel(alarm(c));
      return;
    }
    long at = start.atTime(8,0).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
    if (at > System.currentTimeMillis()) {
      alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarm(c));
      return;
    }
    alarms.cancel(alarm(c));
    if (!notificationsEnabled(c)) return;
    NotificationManager manager = c.getSystemService(NotificationManager.class);
    String title = AppLanguage.text(c,"license.title");
    manager.createNotificationChannel(new NotificationChannel(CHANNEL,title,NotificationManager.IMPORTANCE_DEFAULT));
    Intent open = new Intent(c,AccountActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
        .putExtra("fieldAlert","license").putExtra("fieldOwner",cache.getString("owner",""));
    PendingIntent target = PendingIntent.getActivity(c,ID,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
    manager.notify(ID,new Notification.Builder(c,CHANNEL).setSmallIcon(R.drawable.notification)
        .setContentTitle(title).setContentText(message(c)).setContentIntent(target).setAutoCancel(true)
        .setVisibility(Notification.VISIBILITY_PRIVATE).build());
    cache.edit().putBoolean("delivered",true).apply();
  }

  @Override public void onReceive(Context context, Intent event) {
    reconcile(context);
  }
}
