package app.anglers.journal;

import android.app.Activity;
import android.os.Bundle;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.TextView;
import java.text.DateFormat;
import java.util.Date;

/** Controls the device-wide atlas. An angler can refresh even with automatic checks disabled. */
public final class WaterSettingsActivity extends Activity {
  private TextView status, subscriptionStatus;
  private AccountLayout ui;
  private Button check;
  private String pending;
  private final java.util.Map<String,CheckBox> alertControls=new java.util.HashMap<>();

  static float textScale(android.content.Context c) {
    return c.getSharedPreferences("appearance",MODE_PRIVATE).getBoolean("large",false) ? 1.3f : 1f;
  }

  private final android.content.SharedPreferences.OnSharedPreferenceChangeListener editionListener = (prefs, key) -> {
    if (WaterCatalogue.CHECKED.equals(key) || WaterCatalogue.REVISION.equals(key)) showStatus();
  };

  private final android.content.SharedPreferences.OnSharedPreferenceChangeListener alertListener =
      (prefs, key) -> showSubscriptionStatus();

  private void showSubscriptionStatus() {
    boolean waiting = FieldAlerts.enabled(this, FieldAlerts.POSTS) && !FieldAlerts.prefs(this).contains("cursor");
    subscriptionStatus.setVisibility(waiting ? android.view.View.VISIBLE : android.view.View.GONE);
  }

  private String text(String key) { return AppLanguage.text(this, key); }

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    ui = new AccountLayout(this);
    pending=state==null ? null : state.getString("alert");
    ui.page(text("settings.title"), false);
    android.content.SharedPreferences appearance=getSharedPreferences("appearance",MODE_PRIVATE);
    CheckBox large=ui.check(text("settings.large"));
    large.setChecked(appearance.getBoolean("large",false));
    large.setOnCheckedChangeListener((v,on) -> { appearance.edit().putBoolean("large",on).apply(); recreate(); });
    CheckBox screenOn=ui.check(text("settings.screen_on"));
    screenOn.setChecked(appearance.getBoolean("screenOn",false));
    screenOn.setOnCheckedChangeListener((v,on) -> appearance.edit().putBoolean("screenOn",on).apply());
    ui.label(text("settings.notifications"));
    for (String kind : new String[]{FieldAlerts.POSTS,FieldAlerts.WATERS,FieldAlerts.NEARBY}) {
      CheckBox box=ui.check(text("alerts."+kind));
      alertControls.put(kind,box);
      box.setChecked(FieldAlerts.enabled(this,kind));
      box.setOnClickListener(v -> {
        if (!box.isChecked()) { FieldAlerts.set(this,kind,false); return; }
        box.setChecked(false);
        pending=kind;
        enablePending();
      });
    }
    ui.label(text("settings.alert_schedule"));
    subscriptionStatus = ui.label(text("alerts.awaiting_registration"));
    ui.button(ui.form,text("settings.system_notifications"),AccountLayout.Action.SECONDARY,() ->
      startActivity(new android.content.Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,getPackageName())));
    ui.label(text("common.water_atlas_updates"));
    CheckBox auto = ui.check(text("atlas_settings.check_automatically_every_day"));
    auto.setChecked(WaterCatalogue.automatic(this));
    auto.setOnCheckedChangeListener((v, enabled) -> WaterCatalogue.setAutomatic(this, enabled));
    ui.label(text("atlas_settings.the_phone_checks_the_atlas_when_online"));
    status = ui.label("");
    check = ui.button(ui.form, text("atlas_settings.check_now"), AccountLayout.Action.PRIMARY, this::refresh);
    ui.button(ui.form, text("common.back"), AccountLayout.Action.SECONDARY, this::finish);
  }

  private void enablePending() {
    if (pending==null) return;
    if (android.os.Build.VERSION.SDK_INT>=33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
        !=android.content.pm.PackageManager.PERMISSION_GRANTED) {
      requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},41); return;
    }
    if (!getSystemService(android.app.NotificationManager.class).areNotificationsEnabled()) {
      pending=null; ui.message(text("settings.permission")); return;
    }
    if (FieldAlerts.NEARBY.equals(pending) && checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION)
        !=android.content.pm.PackageManager.PERMISSION_GRANTED) {
      requestPermissions(new String[]{android.Manifest.permission.ACCESS_COARSE_LOCATION},42); return;
    }
    FieldAlerts.set(this,pending,true);
    alertControls.get(pending).setChecked(true);
    pending=null;
  }

  @Override protected void onSaveInstanceState(Bundle state) {
    super.onSaveInstanceState(state); state.putString("alert",pending);
  }

  @Override public void onRequestPermissionsResult(int code,String[] names,int[] grants) {
    super.onRequestPermissionsResult(code,names,grants);
    if (code!=41 && code!=42) return;
    if (grants.length>0 && grants[0]==android.content.pm.PackageManager.PERMISSION_GRANTED) enablePending();
    else { pending=null; ui.message(text("settings.permission")); }
  }

  @Override protected void onStart() {
    super.onStart();
    WaterCatalogue.prefs(this).registerOnSharedPreferenceChangeListener(editionListener);
    FieldAlerts.prefs(this).registerOnSharedPreferenceChangeListener(alertListener);
    showStatus();
    showSubscriptionStatus();
  }

  @Override protected void onStop() {
    WaterCatalogue.prefs(this).unregisterOnSharedPreferenceChangeListener(editionListener);
    FieldAlerts.prefs(this).unregisterOnSharedPreferenceChangeListener(alertListener);
    super.onStop();
  }

  private void showStatus() {
    long last = WaterCatalogue.prefs(this).getLong(WaterCatalogue.CHECKED, 0);
    String edition = WaterCatalogue.prefs(this).getString(WaterCatalogue.DATE, "");
    status.setText((WaterCatalogue.revision(this).isEmpty() ? text("atlas_settings.atlas_bundled_with_the_app")
        : text("atlas_settings.atlas_edition") + " · " + edition) + "\n"
        + text("atlas_settings.last_successful_check") + " · "
        + (last == 0 ? text("atlas_settings.never") : DateFormat.getDateTimeInstance().format(new Date(last))));
  }

  private void refresh() {
    check.setEnabled(false);
    ui.message(text("atlas_settings.checking_the_atlas"));
    WaterCatalogue.check(this, true, result -> runOnUiThread(() -> {
      if (isFinishing() || isDestroyed()) return;
      check.setEnabled(true);
      showStatus();
      if (result == WaterCatalogue.Result.UPDATED) ui.message(text("atlas_settings.the_updated_atlas_is_available_offline"));
      else if (result == WaterCatalogue.Result.CURRENT) ui.message(text("atlas_settings.your_atlas_is_up_to_date"));
      else ui.message(text("atlas_settings.the_update_failed_your_previous_atlas_is"));
    }));
  }
}
