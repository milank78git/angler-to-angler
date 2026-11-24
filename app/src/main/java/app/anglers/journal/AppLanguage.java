package app.anglers.journal;

import android.content.Context;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import org.json.JSONException;
import org.json.JSONObject;

/** Share WebView dictionaries and overlay region-specific labels on the base language. */
final class AppLanguage {
  private static Locale loaded;
  private static final Map<String, String> messages = new HashMap<>();

  /** Increasing priority: English, primary language, then script and region when available. */
  static List<String> codes(Context context) {
    Locale locale = context.getResources().getConfiguration().getLocales().get(0).stripExtensions();
    List<String> result = new ArrayList<>();
    result.add("en");
    String prefix = "";
    for (String part : locale.toLanguageTag().toLowerCase(Locale.ROOT).split("-")) {
      prefix = prefix.isEmpty() ? (part.equals("nb") ? "no" : part) : prefix + "-" + part;
      if (!prefix.equals("en")) result.add(prefix);
    }
    return result;
  }

  static String document(Context context, String kind) throws IOException {
    List<String> candidates = codes(context);
    Collections.reverse(candidates);
    for (String code : candidates) {
      try {
        return IdentityService.asset(context, kind + "-" + code + ".txt");
      } catch (FileNotFoundException missing) {
        if (code.equals("en")) throw missing;
      }
    }
    throw new FileNotFoundException(kind);
  }

  private static void overlay(Context context, String code) throws IOException, JSONException {
    JSONObject pack = new JSONObject(IdentityService.asset(context, "strings-" + code + ".json"));
    for (Iterator<String> keys = pack.keys(); keys.hasNext(); ) {
      String key = keys.next();
      messages.put(key, pack.getString(key));
    }
  }

  static synchronized String text(Context context, String key) {
    Locale locale = context.getResources().getConfiguration().getLocales().get(0).stripExtensions();
    if (!locale.equals(loaded)) {
      messages.clear();
      try {
        for (String code : codes(context)) {
          try {
            overlay(context, code);
          } catch (FileNotFoundException missing) {
            if (code.equals("en")) throw missing;
          }
        }
        loaded = locale;
      } catch (IOException | JSONException invalid) {
        throw new IllegalStateException("Could not read packaged UI dictionary", invalid);
      }
    }
    return messages.getOrDefault(key, key);
  }

  private AppLanguage() {}
}
