package app.anglers.journal.smoke;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Button;

/** A mailbox in the test APK, with its own Android task and a synthetic confirmation link. */
public final class TestInboxActivity extends Activity {
  @Override
  public void onCreate(Bundle saved) {
    super.onCreate(saved);
    String target = getIntent().getStringExtra("targetPackage");
    if (!"app.anglers.journal.preview".equals(target) && !"app.anglers.journal".equals(target)) {
      finish();
      return;
    }
    Uri link = Uri.parse(target + "://account/callback?code=fixture-code");
    Button message = new Button(this);
    message.setText("Test email link");
    message.setOnClickListener(
        v ->
            startActivity(
                new Intent(Intent.ACTION_VIEW, link).addCategory(Intent.CATEGORY_BROWSABLE)));
    setContentView(message);
  }
}
