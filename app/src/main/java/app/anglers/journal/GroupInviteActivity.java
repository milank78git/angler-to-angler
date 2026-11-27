package app.anglers.journal;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/** Accept only an invitation code. Joining always requires the recipient's confirmation. */
public final class GroupInviteActivity extends Activity {
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    Uri uri = getIntent().getData();
    if (Intent.ACTION_VIEW.equals(getIntent().getAction()) && uri != null && uri.isHierarchical()
        && getPackageName().equals(uri.getScheme()) && "group".equals(uri.getEncodedAuthority())
        && "/join".equals(uri.getEncodedPath())) {
      String code = uri.getQueryParameter("code");
      if (code != null && code.matches("(?i)[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}"))
        startActivity(new Intent(this, AccountActivity.class).putExtra("invite", code)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP));
    }
    finish();
  }
}
