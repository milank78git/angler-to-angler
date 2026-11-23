package app.anglers.journal;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/** Deliver external links to the journal task even when a mail app opens them in its own task. */
public final class AccountCallbackActivity extends Activity {
  static boolean matches(Context app, Intent intent) {
    Uri uri = intent.getData();
    return Intent.ACTION_VIEW.equals(intent.getAction())
        && uri != null
        && app.getPackageName().equals(uri.getScheme())
        && "account".equals(uri.getEncodedAuthority())
        && "/callback".equals(uri.getEncodedPath());
  }

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    Intent link = getIntent();
    if (matches(this, link)) {
      startActivity(
          new Intent(Intent.ACTION_VIEW, link.getData(), this, AccountActivity.class)
              .addFlags(
                  Intent.FLAG_ACTIVITY_NEW_TASK
                      | Intent.FLAG_ACTIVITY_CLEAR_TOP
                      | Intent.FLAG_ACTIVITY_SINGLE_TOP));
    }
    finish();
  }
}
