package app.anglers.journal;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/** Deliver external links to the journal task even when a mail app opens them in its own task. */
public final class AccountCallbackActivity extends Activity {
  static String redirect(Context app) {
    return app.getResources().getBoolean(R.bool.use_verified_links) ? webCallback(app)
        : app.getPackageName() + "://account/callback";
  }

  private static String webCallback(Context app) {
    return "https://" + app.getString(R.string.app_link_host) + "/account/" + app.getPackageName() + "/callback";
  }

  static boolean matches(Context app, Intent intent) {
    Uri uri = intent.getData();
    if (!Intent.ACTION_VIEW.equals(intent.getAction()) || uri == null || !uri.isHierarchical()) return false;
    String base = uri.buildUpon().clearQuery().fragment(null).build().toString();
    // Issued pilot links remain valid during the transition to verified HTTPS links.
    return base.equals(webCallback(app)) || base.equals(app.getPackageName() + "://account/callback");
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
