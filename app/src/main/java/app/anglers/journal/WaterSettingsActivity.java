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
  private TextView status;
  private AccountLayout ui;
  private Button check;
  private final android.content.SharedPreferences.OnSharedPreferenceChangeListener editionListener = (prefs, key) -> {
    if (WaterCatalogue.CHECKED.equals(key) || WaterCatalogue.REVISION.equals(key)) showStatus();
  };

  private String text(String key) { return AppLanguage.text(this, key); }

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    ui = new AccountLayout(this);
    ui.page(text("common.water_atlas_updates"), false);
    CheckBox auto = ui.check(text("atlas_settings.check_automatically_every_day"));
    auto.setChecked(WaterCatalogue.automatic(this));
    auto.setOnCheckedChangeListener((v, enabled) -> WaterCatalogue.setAutomatic(this, enabled));
    ui.label(text("atlas_settings.the_phone_checks_the_atlas_when_online"));
    status = ui.label("");
    check = ui.button(ui.form, text("atlas_settings.check_now"), AccountLayout.Action.PRIMARY, this::refresh);
    ui.button(ui.form, text("common.back"), AccountLayout.Action.SECONDARY, this::finish);
  }

  @Override protected void onStart() {
    super.onStart();
    WaterCatalogue.prefs(this).registerOnSharedPreferenceChangeListener(editionListener);
    showStatus();
  }

  @Override protected void onStop() {
    WaterCatalogue.prefs(this).unregisterOnSharedPreferenceChangeListener(editionListener);
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
