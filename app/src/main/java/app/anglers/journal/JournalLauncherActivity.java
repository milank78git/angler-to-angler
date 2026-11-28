package app.anglers.journal;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/** Starts the private account screen without forwarding caller-controlled data or extras. */
public final class JournalLauncherActivity extends Activity {
  /** Choose the initial activity from the stored account and launch intent. */
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    if (isTaskRoot() && Intent.ACTION_MAIN.equals(getIntent().getAction())
        && getIntent().hasCategory(Intent.CATEGORY_LAUNCHER)) {
      startActivity(new Intent(this, AccountActivity.class));
    }
    finish();
  }
}
