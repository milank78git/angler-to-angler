package app.anglers.journal;

import android.app.*;
import android.app.job.*;
import android.content.*;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/** Opt-in field alerts share no account credentials with scheduled background work. */
final class FieldAlerts {
  static final String POSTS="posts", WATERS="waters", NEARBY="nearby";
  private static final int JOB = 473002;
  private static final ExecutorService IO = Executors.newSingleThreadExecutor();

  static SharedPreferences prefs(Context c) { return c.getSharedPreferences("field-alerts", Context.MODE_PRIVATE); }
  static boolean enabled(Context c, String kind) { return prefs(c).getBoolean(kind,false); }

  static synchronized void set(Context c, String kind, boolean on) {
    SharedPreferences.Editor edit = prefs(c).edit().putBoolean(kind,on);
    if (POSTS.equals(kind)) {
      revoke(c);
      edit.remove("cursor").remove("registered").remove("key").remove("acknowledgedWaters");
      if (on) edit.putString("key",UUID.randomUUID().toString());
    }
    if (NEARBY.equals(kind)) edit.remove("lastNearby");
    edit.apply();
    if (!on) c.getSystemService(NotificationManager.class).cancel(kind,1);
    if (POSTS.equals(kind)) {
      JobScheduler scheduler=c.getSystemService(JobScheduler.class);
      if (on) {
        scheduler.schedule(new JobInfo.Builder(JOB,new ComponentName(c,FieldAlertJob.class))
          .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true)
          .setPeriodic(TimeUnit.HOURS.toMillis(1)).build());
        checkPosts(c,null);
      } else scheduler.cancel(JOB);
    }
  }

  static synchronized void clear(Context c) {
    revoke(c);
    prefs(c).edit().clear().apply();
    c.getSystemService(JobScheduler.class).cancel(JOB);
    for (String kind : new String[]{POSTS,WATERS,NEARBY}) c.getSystemService(NotificationManager.class).cancel(kind,1);
  }

  /** Invalidate the previous device subscription. Offline subscriptions expire on the server. */
  private static void revoke(Context context) {
    Context c = context.getApplicationContext();
    String key = prefs(c).getString("key", "");
    if (key.isEmpty()) return;
    IO.execute(() -> {
      try { new IdentityService(c).endPostWatch(new JSONObject().put("device_key", key)); }
      catch (Exception unavailable) { android.util.Log.w("FieldAlerts", "Post subscription will expire"); }
    });
  }

  static synchronized void favourites(Context c, String owner, String keys) {
    if (owner.isEmpty() || !owner.equals(AccountStore.active(c)) || keys.length() > 220000) return;
    SharedPreferences p = prefs(c);
    if (keys.equals(p.getString("watersForPosts", "[]"))) return;
    p.edit().putString("watersForPosts", keys).remove("cursor").remove("registered").apply();
    if (enabled(c, POSTS)) checkPosts(c, null);
  }

  /** Advance the cursor only after delivery, and ignore work from a previous opt-in or account. */
  static void checkPosts(Context context, Runnable done) {
    Context c=context.getApplicationContext();
    IO.execute(() -> {
      SharedPreferences p=prefs(c);
      String key=p.getString("key","");
      try {
        if (key.isEmpty() || !enabled(c,POSTS)) return;
        IdentityService service=new IdentityService(c);
        JSONObject args=new JSONObject().put("device_key",key);
        String actor=AccountStore.active(c);
        long now=System.currentTimeMillis();
        boolean register=!actor.isEmpty() && now-p.getLong("registered",0)>TimeUnit.DAYS.toMillis(7);
        String selected = p.getString("watersForPosts","[]");
        if (!register && !selected.equals(p.getString("acknowledgedWaters",null))) return;
        JSONObject signal = register
            ? AccountStore.rpc(c,service,actor,"watch_favourites",args.put("water_keys",new org.json.JSONArray(selected)))
            : service.postSignal(args);
        long latest=signal.getLong("position");
        synchronized (FieldAlerts.class) {
          if (!key.equals(p.getString("key","")) || !selected.equals(p.getString("watersForPosts","[]"))) return;
          long previous=p.getLong("cursor",-1);
          if (previous<0 || latest<=previous || post(c,POSTS,AppLanguage.text(c,"alerts.new_post"),signal.optString("water")))
            p.edit().putLong("cursor",Math.max(previous,latest)).apply();
          if (register) p.edit().putString("acknowledgedWaters",selected).putLong("registered",now).apply();
        }
      } catch (Exception error) { android.util.Log.w("FieldAlerts","Post check unavailable"); }
      finally { if (done!=null) done.run(); }
    });
  }

  static synchronized void nearby(Context c, String id, String name) {
    if (!id.equals(prefs(c).getString("lastNearby","")) && post(c,NEARBY,name,id))
      prefs(c).edit().putString("lastNearby",id).apply();
  }

  static synchronized boolean post(Context c, String kind, String body, String water) {
    if (!enabled(c,kind)) return false;
    NotificationManager manager=c.getSystemService(NotificationManager.class);
    String channel="field-"+kind;
    manager.createNotificationChannel(new NotificationChannel(channel,AppLanguage.text(c,"alerts."+kind),
        NotificationManager.IMPORTANCE_DEFAULT));
    if (!manager.areNotificationsEnabled() || manager.getNotificationChannel(channel).getImportance()==NotificationManager.IMPORTANCE_NONE) return false;
    Intent open=new Intent(c,AccountActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
        .putExtra("fieldAlert",kind).putExtra("fieldWater",water).putExtra("fieldOwner",AccountStore.prefs(c).getString("subject",""));
    PendingIntent target=PendingIntent.getActivity(c,kind.hashCode(),open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
    manager.notify(kind,1,new Notification.Builder(c,channel).setSmallIcon(R.drawable.notification)
        .setContentTitle(AppLanguage.text(c,"alerts."+kind)).setContentText(body)
        .setVisibility(Notification.VISIBILITY_PRIVATE).setAutoCancel(true).setContentIntent(target).build());
    return true;
  }
}
