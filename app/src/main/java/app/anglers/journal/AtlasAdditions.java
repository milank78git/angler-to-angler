package app.anglers.journal;

import android.content.Context;
import android.util.JsonReader;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;

/** Compare published identities without loading geometry into the background worker's heap. */
final class AtlasAdditions {
  private static void edition(JsonReader r,String provider,Set<String> ids) throws IOException {
    r.beginObject();
    while (r.hasNext()) {
      if (!r.nextName().equals("waters")) { r.skipValue(); continue; }
      r.beginArray();
      while (r.hasNext()) {
        r.beginObject();
        while (r.hasNext()) {
          String field=r.nextName();
          if (field.equals(provider.isEmpty()?"id":"code")) ids.add(provider.isEmpty()?r.nextString():provider+":"+r.nextString());
          else r.skipValue();
        }
        r.endObject();
      }
      r.endArray();
    }
    r.endObject();
  }

  private static void europe(JsonReader r,Set<String> ids) throws IOException {
    r.beginObject();
    while (r.hasNext()) edition(r,r.nextName(),ids);
    r.endObject();
  }

  private static JsonReader reader(InputStream in) {
    return new JsonReader(new BufferedReader(new InputStreamReader(in,StandardCharsets.UTF_8)));
  }

  static Set<String> identities(Context c,String revision) throws IOException {
    Set<String> ids=new HashSet<>();
    if (revision.isEmpty()) {
      try (JsonReader r=reader(c.getAssets().open("czech-waters.json"))) { edition(r,"",ids); }
      try (JsonReader r=reader(c.getAssets().open("europe-waters.json"))) { europe(r,ids); }
    } else try (JsonReader r=reader(WaterCatalogue.open(c,revision))) {
      r.beginObject();
      while (r.hasNext()) {
        String field=r.nextName();
        if (field.equals("cz")) edition(r,"",ids);
        else if (field.equals("europe")) europe(r,ids);
        else r.skipValue();
      }
      r.endObject();
    }
    return ids;
  }

  static void notify(Context c,String previous,String installed) {
    if (!FieldAlerts.enabled(c,FieldAlerts.WATERS)) return;
    try {
      Set<String> added=identities(c,installed);
      added.removeAll(identities(c,previous));
      if (added.isEmpty()) return;
      FieldAlerts.prefs(c).edit().putStringSet("additions",added).apply();
      FieldAlerts.post(c,FieldAlerts.WATERS,
          AppLanguage.text(c,"alerts.added").replace("{count}",Integer.toString(added.size())),"");
    } catch (IOException error) { android.util.Log.w("AtlasAdditions","Cannot compare water directories",error); }
  }
}
