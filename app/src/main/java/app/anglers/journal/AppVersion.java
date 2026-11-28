package app.anglers.journal;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;

/** Formats the version of the installed Android package for the account screens and journal. */
final class AppVersion {
  /** Use the static installed-package lookup for version labels. */
  private AppVersion() {}

  /** Expose the installed build's version label to the journal UI. */
  static String label(Context context) {
    String packageName = context.getPackageName();
    try {
      PackageInfo info = context.getPackageManager().getPackageInfo(packageName, 0);
      long code = info.getLongVersionCode();
      int format = packageName.endsWith(".preview") ? R.string.pilot_version : R.string.app_version;
      return context.getString(format, info.versionName, code);
    } catch (PackageManager.NameNotFoundException e) {
      return context.getString(R.string.version_unavailable);
    }
  }
}
