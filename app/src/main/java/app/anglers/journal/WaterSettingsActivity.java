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

  private String text(String cs, String en) { return AppLanguage.text(this, cs, en); }

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    ui = new AccountLayout(this);
    ui.page(text("Aktualizace atlasu revírů", "Water atlas updates"), false);
    CheckBox auto = ui.check(text("Automaticky kontrolovat každý den", "Check automatically every day"));
    auto.setChecked(WaterCatalogue.automatic(this));
    auto.setOnCheckedChangeListener((v, enabled) -> WaterCatalogue.setAutomatic(this, enabled));
    ui.label(text("Telefon zkontroluje atlas při dostupném připojení. Při odložení systémem kontrolu doplní při otevření aplikace.",
        "The phone checks the atlas when online. If Android defers the check, opening the app catches up."));
    status = ui.label("");
    check = ui.button(ui.form, text("Zkontrolovat nyní", "Check now"), AccountLayout.Action.PRIMARY, this::refresh);
    ui.button(ui.form, text("Zpět", "Back"), AccountLayout.Action.SECONDARY, this::finish);
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
    status.setText((WaterCatalogue.revision(this).isEmpty() ? text("Atlas dodaný s aplikací", "Atlas bundled with the app")
        : text("Vydání atlasu", "Atlas edition") + " · " + edition) + "\n"
        + text("Poslední úspěšná kontrola", "Last successful check") + " · "
        + (last == 0 ? text("zatím neproběhla", "never") : DateFormat.getDateTimeInstance().format(new Date(last))));
  }

  private void refresh() {
    check.setEnabled(false);
    ui.message(text("Kontroluji atlas…", "Checking the atlas…"));
    WaterCatalogue.check(this, true, result -> runOnUiThread(() -> {
      if (isFinishing() || isDestroyed()) return;
      check.setEnabled(true);
      showStatus();
      if (result == WaterCatalogue.Result.UPDATED) ui.message(text("Nový atlas je k dispozici offline.", "The updated atlas is available offline."));
      else if (result == WaterCatalogue.Result.CURRENT) ui.message(text("Máš aktuální atlas.", "Your atlas is up to date."));
      else ui.message(text("Aktualizace se nezdařila. Dosavadní atlas můžeš dál používat.", "The update failed. Your previous atlas is still available."));
    }));
  }
}
