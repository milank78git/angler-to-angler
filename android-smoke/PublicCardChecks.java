package app.anglers.journal.smoke;

import android.graphics.BitmapFactory;
import android.util.Base64;
import java.io.IOException;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Check the exact public preview, a lost receipt, and management from another application screen.
 */
final class PublicCardChecks {
  private final String token = UUID.randomUUID().toString();
  private JSONObject request, active;
  private final String water = "Sázava 1 · 401 009";

  JSONObject response(String op, JSONObject args) throws Exception {
    switch (op) {
      case "public_card_options":
        return new JSONObject()
            .put("name", "River")
            .put("water", water)
            .put("active", active == null ? JSONObject.NULL : active);
      case "public_cards":
        return new JSONObject()
            .put("items", active == null ? new JSONArray() : new JSONArray().put(active));
      case "public_card_publish":
        JSONObject draft = args.getJSONObject("draft");
        byte[] pixels = Base64.decode(args.getString("photo"), Base64.DEFAULT);
        if (args.length() != 5
            || draft.length() != 5
            || !water.equals(draft.getString("water"))
            || !"River".equals(draft.getString("name"))
            || !"Perch".equals(draft.getString("species"))
            || !"day".equals(draft.getString("precision"))
            || !draft.getString("date").matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")
            || !"CZ:401009".equals(args.getString("water_key"))
            || BitmapFactory.decodeByteArray(pixels, 0, pixels.length).getWidth() != 32
            || new String(pixels, java.nio.charset.StandardCharsets.ISO_8859_1)
                .contains("private-gps-marker"))
          throw new AssertionError("Unexpected public document");
        if (request == null) {
          request = new JSONObject(args.toString());
          active =
              new JSONObject()
                  .put("id", token)
                  .put("url", "https://example.test/#" + token)
                  .put("species", draft.getString("species"))
                  .put("date", draft.getString("date"))
                  .put("precision", "day");
          throw new IOException("Simulated lost receipt");
        }
        if (!args.toString().equals(request.toString())) throw new AssertionError("Retry changed");
        return active;
      case "public_card_withdraw":
        if (!token.equals(args.getString("link_id"))) throw new AssertionError("Wrong link");
        active = null;
        return new JSONObject();
      default:
        throw new AssertionError(op);
    }
  }

  static void run(Runner app) throws Exception {
    app.clickReady("#tabtrips");
    app.clickReady("[data-trip]");
    app.clickReady("article:has([data-weekly-catch]) [data-public-catch]");
    app.waitFor(
        "document.querySelector('#public-preview time')?.dateTime.length===7 &&"
            + " !document.querySelector('#public-preview img')");
    app.clickReady("#public-day");
    app.clickReady("#public-water");
    app.clickReady("#public-photo");
    app.waitFor(
        "document.querySelector('#public-preview img')?.naturalWidth===32 &&"
            + " document.querySelector('#public-preview time')?.dateTime.length===10");
    app.capture("public-catch-preview");
    app.clickReady("#public-publish");
    app.clickReady("#confirmation-cancel");
    app.clickReady("#public-publish");
    app.clickReady("#confirmation-accept");
    app.waitFor(
        "!!document.querySelector('#public-publish') &&"
            + " !document.querySelector('#public-publish').disabled &&"
            + " !document.querySelector('#notice').hidden");
    app.clickReady("#public-publish");
    app.clickReady("#confirmation-accept");
    app.waitFor("!!document.querySelector('a[href^=\"https://example.test/#\"]')");
    app.clickReady("#profile");
    app.clickReady("#my-public-cards");
    app.waitFor("!!document.querySelector('article a[href^=\"https://example.test/#\"]')");
    app.clickReady("article .danger");
    app.clickReady("#confirmation-accept");
    app.waitFor(
        "document.querySelector('#screen').dataset.page==='myPublicCards' &&"
            + " !!document.querySelector('#back') && !document.querySelector('article')");
  }
}
