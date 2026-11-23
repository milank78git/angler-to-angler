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
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/** Reschedules opt-in seasonal transitions and the review date of a finite regional pack. */
public final class SeasonReminder extends BroadcastReceiver {
    private static final String FIRE="app.anglers.journal.SEASON";
    private static final String CHANNEL="fishing-seasons";
    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("season-watches",0); }
    static boolean watching(Context c,String key) {return prefs(c).contains(key);}
    private static PendingIntent alarm(Context c,String key,long stamp) {
        Intent i=new Intent(c,SeasonReminder.class).setAction(FIRE)
                .setData(Uri.parse("angler:season/"+Uri.encode(key))).putExtra("key",key).putExtra("due",stamp);
        return PendingIntent.getBroadcast(c,0,i,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
    }
    static void toggle(Context c,String key,boolean enabled) {
        if (key==null || !key.matches("[0-9]{6}/[a-z]+")) return;
        if (!enabled) {
            prefs(c).edit().remove(key).apply();
            c.getSystemService(AlarmManager.class).cancel(alarm(c,key,0));
        } else schedule(c,key,false,0);
    }
    @Override public void onReceive(Context c,Intent intent) {
        if (FIRE.equals(intent.getAction())) {
            String key=intent.getStringExtra("key");
            long due=intent.getLongExtra("due",0);
            if (key!=null && due>0 && prefs(c).getLong(key,0)==due) schedule(c,key,true,due);
        } else for (String key:prefs(c).getAll().keySet()) schedule(c,key,false,0);
    }
    private static JSONObject catalog(Context c) throws Exception {
        try(BufferedReader r=new BufferedReader(new InputStreamReader(c.getAssets().open("catalog.json"),"UTF-8"))) {
            StringBuilder json=new StringBuilder();String line;
            while ((line=r.readLine())!=null) json.append(line);
            return new JSONObject(json.toString());
        }
    }
    private static boolean closed(JSONArray bounds, LocalDate day) throws Exception {
        String md=day.toString().substring(5), a=bounds.getString(0), b=bounds.getString(1);
        return a.compareTo(b)<=0 ? md.compareTo(a)>=0 && md.compareTo(b)<=0 : md.compareTo(a)>=0 || md.compareTo(b)<=0;
    }
    private static void schedule(Context c,String key,boolean notify,long due) {
        try {
            JSONObject pack=catalog(c);
            String[] parts=key.split("/");
            JSONObject fish=pack.getJSONObject("species").getJSONObject(parts[1]),water=null;
            JSONArray waters=pack.getJSONArray("waters");
            for(int i=0;i<waters.length();i++) if(parts[0].equals(waters.getJSONObject(i).getString("id"))) water=waters.getJSONObject(i);
            if(water==null) return;
            ZoneId zone=ZoneId.of(pack.getString("zone"));
            LocalDate today=LocalDate.now(zone), end=LocalDate.parse(pack.getString("until"));
            LocalDate start=LocalDate.parse(pack.getString("from"));
            JSONArray bounds=fish.getJSONArray("window");
            boolean cs=Locale.getDefault().getLanguage().equals("cs");
            if (notify && today.equals(Instant.ofEpochMilli(due).atZone(zone).toLocalDate())) {
                String note=today.isAfter(end) ? (cs?"Skončila platnost podkladů. Ověřte aktuální podmínky.":"The local rules pack has expired. Check the current conditions.")
                    : closed(bounds,today) ? (cs?"Dnes začíná hájení.":"The closed season begins today.")
                    : (cs?"Uvedené období hájení skončilo. Ověřte další místní podmínky.":"The listed closed season has ended. Check other local restrictions.");
                post(c,key,water.getString("name")+" · "+fish.getString(cs?"cs":"en"),note);
            }
            if(today.isAfter(end)) {prefs(c).edit().remove(key).apply();return;}
            Instant now=Instant.now();
            LocalDate candidate=today.isBefore(start)?start:today;
            for(;!candidate.isAfter(end.plusDays(1));candidate=candidate.plusDays(1)) {
                Instant at=candidate.atTime(LocalTime.of(8,0)).atZone(zone).toInstant();
                if(!at.isAfter(now)) continue;
                if(candidate.equals(end.plusDays(1)) || (!candidate.equals(start) && closed(bounds,candidate)!=closed(bounds,candidate.minusDays(1)))) {
                    long stamp=at.toEpochMilli();
                    prefs(c).edit().putLong(key,stamp).apply();
                    c.getSystemService(AlarmManager.class).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,stamp,alarm(c,key,stamp));
                    return;
                }
            }
        } catch(Exception e) {android.util.Log.e("SeasonReminder","Cannot schedule a local season reminder",e);}
    }
    private static void post(Context c,String key,String title,String body) {
        NotificationManager manager=c.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL,c.getString(R.string.season),NotificationManager.IMPORTANCE_DEFAULT));
        Intent open=new Intent(c,FishingActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent target=PendingIntent.getActivity(c,0,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        manager.notify(key,1,new Notification.Builder(c,CHANNEL).setSmallIcon(R.drawable.notification).setContentTitle(title)
            .setContentText(body).setStyle(new Notification.BigTextStyle().bigText(body)).setContentIntent(target).setAutoCancel(true).build());
    }
}
