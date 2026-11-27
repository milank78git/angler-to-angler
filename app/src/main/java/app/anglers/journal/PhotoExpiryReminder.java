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
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;

/** Group the two reminder windows without storing catch names, locations or pictures. */
public final class PhotoExpiryReminder extends BroadcastReceiver {
  private static final int ID = 4817;
  private static final String CHANNEL = "journal-photo-expiry";
  private static SharedPreferences prefs(Context c) {
    return c.getSharedPreferences(CHANNEL, Context.MODE_PRIVATE);
  }
  private static PendingIntent alarm(Context c) {
    return PendingIntent.getBroadcast(c, ID, new Intent(c, PhotoExpiryReminder.class), PendingIntent.FLAG_IMMUTABLE);
  }
  static synchronized void clear(Context c) {
    prefs(c).edit().clear().apply();
    c.getSystemService(AlarmManager.class).cancel(alarm(c));
    c.getSystemService(NotificationManager.class).cancel(ID);
  }
  static synchronized void remember(Context c,String owner,String dates) {
    if (!owner.equals(AccountStore.prefs(c).getString("subject","")) || dates.length()>20000) return;
    Set<String> valid=new HashSet<>();
    try {
      JSONArray source=new JSONArray(dates);
      for (int i=0;i<source.length();i++) valid.add(LocalDate.parse(source.getString(i)).toString());
    } catch (Exception invalid) { return; }
    if(valid.isEmpty()) { clear(c); return; }
    if(!owner.equals(prefs(c).getString("owner",""))) clear(c);
    prefs(c).edit().putString("owner",owner).putStringSet("dates",valid).apply();
    reconcile(c);
  }
  static synchronized void reconcile(Context c) {
    SharedPreferences p=prefs(c);
    String owner=p.getString("owner","");
    if(owner.isEmpty() || !owner.equals(AccountStore.prefs(c).getString("subject",""))) {clear(c);return;}
    LocalDate today=LocalDate.now(),next=null;
    Set<String> sent=p.getStringSet("sent",java.util.Collections.emptySet()), retained=new HashSet<>(),due=new HashSet<>();
    for(String value:p.getStringSet("dates",java.util.Collections.emptySet())) {
      LocalDate end=LocalDate.parse(value);
      if(!today.isBefore(end))continue;
      for(int days:new int[]{30,7}) {
        String key=value+"/"+days; LocalDate when=end.minusDays(days);
        if(sent.contains(key))retained.add(key);
        else if(!when.isAfter(today))due.add(key);
        else if(next==null || when.isBefore(next))next=when;
      }
    }
    AlarmManager alarms=c.getSystemService(AlarmManager.class);
    alarms.cancel(alarm(c));
    if(!due.isEmpty()) {
      NotificationManager manager=c.getSystemService(NotificationManager.class);
      String title=AppLanguage.text(c,"retention.title");
      manager.createNotificationChannel(new NotificationChannel(CHANNEL,title,NotificationManager.IMPORTANCE_DEFAULT));
      if(manager.areNotificationsEnabled() && manager.getNotificationChannel(CHANNEL).getImportance()!=NotificationManager.IMPORTANCE_NONE) {
        Intent open=new Intent(c,AccountActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra("fieldAlert","photoExpiry").putExtra("fieldOwner",owner);
        PendingIntent target=PendingIntent.getActivity(c,ID,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        manager.notify(ID,new Notification.Builder(c,CHANNEL).setSmallIcon(R.drawable.notification)
            .setContentTitle(title).setContentText(AppLanguage.text(c,"retention.notice")).setContentIntent(target)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setAutoCancel(true).build());
        retained.addAll(due);
      }
    }
    p.edit().putStringSet("sent",retained).apply();
    if(next!=null)alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,
        next.atTime(8,0).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli(),alarm(c));
  }
  @Override public void onReceive(Context c,Intent event) {reconcile(c);}
}
