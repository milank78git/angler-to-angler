package app.anglers.journal;

import android.app.Activity;
import android.content.Context;
import android.os.Build;

/** Keep activity resources and their WebViews in the selected app language on Android 9–12. */
abstract class LocalizedActivity extends Activity {
  private String attachedLanguage;

  /** Apply the app's language before activity resources are resolved. */
  @Override protected void attachBaseContext(Context base) {
    attachedLanguage = AppLanguage.selection(base);
    super.attachBaseContext(AppLanguage.localized(base));
  }

  /** Check the selected locale when returning to an existing activity. */
  @Override protected void onStart() {
    super.onStart();
    if (Build.VERSION.SDK_INT < 33 && !attachedLanguage.equals(AppLanguage.selection(this))) recreate();
  }
}
