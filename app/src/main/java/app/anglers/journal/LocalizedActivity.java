package app.anglers.journal;

import android.app.Activity;
import android.content.Context;
import android.os.Build;

/** Keep activity resources and their WebViews in the selected app language on Android 8–12. */
abstract class LocalizedActivity extends Activity {
  private String attachedLanguage;

  @Override protected void attachBaseContext(Context base) {
    attachedLanguage = AppLanguage.selection(base);
    super.attachBaseContext(AppLanguage.localized(base));
  }

  @Override protected void onStart() {
    super.onStart();
    if (Build.VERSION.SDK_INT < 33 && !attachedLanguage.equals(AppLanguage.selection(this))) recreate();
  }
}
