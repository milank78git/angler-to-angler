package app.anglers.journal;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.LinkedHashMap;

/** Offer an explicit driving route when supported and a pinned destination to other map apps. */
final class ParkingNavigation {
  /** Keep map intent construction independent of a retained activity instance. */
  private ParkingNavigation() {}

  /** Launch the map handler for a checked destination and report its availability. */
  static void open(Activity activity, double lat, double lon) {
    if (!Double.isFinite(lat) || !Double.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) return;
    String point=lat+","+lon;
    Intent geo=new Intent(Intent.ACTION_VIEW, Uri.parse("geo:"+point+"?q="+point));
    PackageManager pm=activity.getPackageManager();
    LinkedHashMap<String,Intent> available=new LinkedHashMap<>();
    for (ResolveInfo app : pm.queryIntentActivities(geo,PackageManager.MATCH_DEFAULT_ONLY)) {
      String pkg=app.activityInfo.packageName;
      available.put(pkg,new Intent(geo).setPackage(pkg));
    }
    driving(pm,available,"com.google.android.apps.maps","google.navigation:q="+point+"&mode=d");
    driving(pm,available,"com.waze","https://waze.com/ul?ll="+point+"&navigate=yes");
    driving(pm,available,"cz.seznam.mapy","https://mapy.com/fnc/v1/route?end="+lon+","+lat+"&routeType=car_fast&navigate=true");
    ArrayList<String> labels=new ArrayList<>();
    ArrayList<Intent> intents=new ArrayList<>();
    for (Intent intent:available.values()) {
      ResolveInfo handler=pm.resolveActivity(intent,PackageManager.MATCH_DEFAULT_ONLY);
      if (handler!=null) {labels.add(handler.loadLabel(pm).toString());intents.add(intent);}
    }
    labels.add(AppLanguage.text(activity,"parking.copy"));
    new android.app.AlertDialog.Builder(activity).setTitle(AppLanguage.text(activity,"parking.drive"))
        .setItems(labels.toArray(new String[0]),(dialog,i)->{
          if(i==intents.size()) {
            ClipboardManager clipboard=(ClipboardManager)activity.getSystemService(Activity.CLIPBOARD_SERVICE);
            clipboard.setPrimaryClip(ClipData.newPlainText("GPS",point));
          } else try {activity.startActivity(intents.get(i));}
          catch(ActivityNotFoundException e){Toast.makeText(activity,R.string.open_error,Toast.LENGTH_SHORT).show();}
        }).show();
  }

  /** Build driving directions from the published parking coordinates. */
  private static void driving(PackageManager pm,LinkedHashMap<String,Intent> choices,String pkg,String uri) {
    Intent intent=new Intent(Intent.ACTION_VIEW,Uri.parse(uri)).setPackage(pkg);
    if(intent.resolveActivity(pm)!=null) choices.put(pkg,intent);
  }
}
