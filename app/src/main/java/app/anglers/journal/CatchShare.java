package app.anglers.journal;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicBoolean;

/** Creates the Android chooser from a user-reviewed caption and optional pixel-only JPEG. */
final class CatchShare {
  static final int REQUEST = 57;
  private final Activity activity;
  private final AtomicBoolean choosing = new AtomicBoolean();

  CatchShare(Activity activity) {
    this.activity = activity;
  }

  /** Called on the WebView bridge thread. Only the chooser itself needs the main thread. */
  boolean open(String caption, String encoded) {
    if (caption == null
        || caption.isEmpty()
        || caption.length() > 4096
        || encoded == null
        || encoded.length() > 4 * 1024 * 1024) return false;
    if (!choosing.compareAndSet(false, true)) return false;
    Intent send =
        new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, caption);
    try {
      if (!encoded.isEmpty()) {
        byte[] jpeg = Base64.decode(encoded, Base64.NO_WRAP);
        if (jpeg.length < 4 || jpeg[0] != (byte) 0xff || jpeg[1] != (byte) 0xd8)
          throw new IOException("Invalid JPEG");
        Uri copy = CatchCardProvider.publish(activity, jpeg);
        send.setType("image/jpeg").putExtra(Intent.EXTRA_STREAM, copy);
        send.setClipData(ClipData.newRawUri("Catch photo", copy));
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      }
    } catch (IOException | IllegalArgumentException error) {
      finished();
      return false;
    }
    activity.runOnUiThread(
        () -> {
          if (activity.isFinishing() || activity.isDestroyed()) {
            finished();
            return;
          }
          try {
            activity.startActivityForResult(Intent.createChooser(send, null), REQUEST);
          } catch (ActivityNotFoundException error) {
            finished();
            android.widget.Toast.makeText(
                    activity, R.string.open_error, android.widget.Toast.LENGTH_LONG)
                .show();
          }
        });
    return true;
  }

  void finished() {
    choosing.set(false);
  }
}
