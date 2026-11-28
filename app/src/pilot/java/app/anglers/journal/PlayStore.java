package app.anglers.journal;

import android.webkit.WebView;

/** The directly distributed APK does not connect to the Play store. */
final class PlayStore {
  /** The pilot constructor shares the Play signature so the journal can use either distribution. */
  PlayStore(FishingActivity activity, WebView web, String subject) {}
  /** The pilot has no billing connection to resume. */
  void resume() {}
  /** The pilot owns no billing resources on activity destruction. */
  void close() {}
}
