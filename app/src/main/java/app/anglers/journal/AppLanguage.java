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

  /** Empty selection follows the phone. Android 13+ owns the setting shared with system Settings. */
  static String selection(Context context) {
    if (android.os.Build.VERSION.SDK_INT >= 33) {
      android.os.LocaleList locales = context.getSystemService(android.app.LocaleManager.class).getApplicationLocales();
      return locales.isEmpty() ? "" : locales.get(0).toLanguageTag();
    }
    return context.getSharedPreferences("appearance", Context.MODE_PRIVATE).getString("language", "");
  }

  static Locale current(Context context) {
    String tag = selection(context);
    return tag.isEmpty() ? context.getResources().getConfiguration().getLocales().get(0).stripExtensions()
        : Locale.forLanguageTag(tag);
  }

  /** Transfer an older in-app choice once when the OS gains per-app locale support. */
  static void migrate(Context context) {
    if (android.os.Build.VERSION.SDK_INT < 33) return;
    android.content.SharedPreferences prefs = context.getSharedPreferences("appearance", Context.MODE_PRIVATE);
    if (!prefs.contains("language")) return;
    String legacy = prefs.getString("language","");
    if (!legacy.isEmpty() && selection(context).isEmpty()) {
      context.getSystemService(android.app.LocaleManager.class).setApplicationLocales(android.os.LocaleList.forLanguageTags(legacy));
    }
    prefs.edit().remove("language").apply();
  }

  static Context localized(Context base) {
    if (android.os.Build.VERSION.SDK_INT >= 33 || selection(base).isEmpty()) return base;
    android.content.res.Configuration copy = new android.content.res.Configuration(base.getResources().getConfiguration());
    copy.setLocale(Locale.forLanguageTag(selection(base)));
    return base.createConfigurationContext(copy);
  }

  static void pick(android.app.Activity activity) {
    List<Locale> locales = new ArrayList<>();
    try {
      org.json.JSONArray codes = new org.json.JSONArray(IdentityService.asset(activity, "ui-locales.json"));
      for (int i = 0; i < codes.length(); i++) locales.add(Locale.forLanguageTag(codes.getString(i)));
    } catch (IOException | JSONException e) {
      throw new IllegalStateException("Missing language index", e);
    }
    java.text.Collator sorter = java.text.Collator.getInstance(current(activity));
    locales.sort((a,b) -> sorter.compare(a.getDisplayName(a), b.getDisplayName(b)));
    String[] names = new String[locales.size()+1];
    names[0] = text(activity, "settings.language_system");
    String selected = selection(activity);
    int checked = selected.isEmpty() ? 0 : -1;
    for (int i = 0; i < locales.size(); i++) {
      Locale locale = locales.get(i);
      names[i+1] = locale.getDisplayName(locale);
      if (locale.toLanguageTag().equalsIgnoreCase(selected)) checked = i+1;
    }
    new android.app.AlertDialog.Builder(activity).setTitle(text(activity,"settings.language"))
        .setSingleChoiceItems(names, checked, (dialog, index) -> {
          dialog.dismiss();
          String tag = index == 0 ? "" : locales.get(index-1).toLanguageTag();
          if (tag.equalsIgnoreCase(selected)) return;
          if (android.os.Build.VERSION.SDK_INT >= 33) {
            activity.getSystemService(android.app.LocaleManager.class)
                .setApplicationLocales(android.os.LocaleList.forLanguageTags(tag));
          } else {
            activity.getSharedPreferences("appearance",Context.MODE_PRIVATE).edit().putString("language",tag).apply();
            activity.recreate();
          }
        }).setNegativeButton(text(activity,"common.cancel"),null).show();
  }

  /** Increasing priority: English, primary language, then script and region when available. */
  static List<String> codes(Context context) {
    Locale locale = current(context);
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
    Locale locale = current(context);
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
