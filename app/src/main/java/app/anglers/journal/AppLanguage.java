package app.anglers.journal;

import android.content.Context;
import org.json.JSONObject;

/** Shares offline UI dictionaries with the journal and honors Android's per-app locale. */
final class AppLanguage {
  private static String loaded = "";
  private static JSONObject messages = new JSONObject();

  static synchronized String text(Context context, String czech, String english) {
    String code = context.getResources().getConfiguration().getLocales().get(0).getLanguage();
    if (code.equals("nb")) code = "no";
    if (!code.equals(loaded)) {
      messages = new JSONObject();
      if (code.matches("[a-z]{2,3}") && !code.equals("en")) {
        try {
          messages = new JSONObject(IdentityService.asset(context, "strings-" + code + ".json"));
        } catch (Exception missingPack) {
          // Devices using an unbundled language can still sign in and read the English guide.
        }
      }
      loaded = code;
    }
    return messages.optString(english, code.equals("cs") ? czech : english);
  }

  private AppLanguage() {}
}
