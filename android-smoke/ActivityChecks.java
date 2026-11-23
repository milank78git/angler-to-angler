package app.anglers.journal.smoke;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Checks a blank-trip contribution and the water report through the authenticated native bridge.
 */
final class ActivityChecks {
  private JSONObject entry;
  private int revision;

  private JSONObject receipt() throws Exception {
    return new JSONObject()
        .put("entry", entry == null ? JSONObject.NULL : entry)
        .put("revision", revision);
  }

  JSONObject response(String op, JSONObject args) throws Exception {
    switch (op) {
      case "activity_summary":
        if (!"CZ:401009".equals(args.getString("water_key")))
          throw new AssertionError("Wrong report water");
        JSONObject sample =
            new JSONObject()
                .put("trips", 12)
                .put("anglers", 6)
                .put("fish", 25)
                .put("successfulTrips", 7);
        return new JSONObject()
            .put("month", "2025-06-01")
            .put("latest", "2025-06-01")
            .put("sample", args.isNull("target_species") ? sample : JSONObject.NULL);
      case "activity_mine":
        return new JSONObject()
            .put("items", entry == null ? new JSONArray() : new JSONArray().put(receipt()));
      case "activity_state":
        return receipt();
      case "activity_change":
        if (args.getInt("expected_revision") != revision)
          throw new AssertionError("Stale activity revision");
        if (args.has("water_key")) {
          if (args.length() != 7
              || args.getInt("fish_count") != 0
              || !"CZ:401009".equals(args.getString("water_key"))
              || !args.getString("month_start").matches("[0-9]{4}-[0-9]{2}-01")
              || !"pike".equals(args.getString("target_species"))
              || !"fly".equals(args.getString("fishing_method")))
            throw new AssertionError("Unexpected activity projection");
          entry =
              new JSONObject()
                  .put("trip", args.getString("trip_id"))
                  .put("water", args.getString("water_key"))
                  .put("month", args.getString("month_start"))
                  .put("fish", 0)
                  .put("target", "pike")
                  .put("method", "fly");
        } else {
          if (args.length() != 2 || !entry.getString("trip").equals(args.getString("trip_id")))
            throw new AssertionError("Wrong withdrawal");
          entry = null;
        }
        revision++;
        return receipt();
      default:
        throw new AssertionError(op);
    }
  }

  static void report(Runner app) throws Exception {
    app.clickReady("#open-activity");
    app.waitFor("document.querySelector('#activity-result')?.textContent.includes('7 / 12')");
    app.capture("water-activity");
    app.js(
        "document.querySelector('#activity-target').value='pike';document.querySelector('#activity-filters').requestSubmit()");
    app.waitFor(
        "document.querySelector('#activity-result') && !document.querySelector('#activity-result"
            + " strong')");
    app.clickReady("#back");
    app.waitFor("!!document.querySelector('#open-rules')");
  }

  static void contribute(Runner app) throws Exception {
    app.clickReady("#trip-activity");
    app.waitFor("!!document.querySelector('#activity-submit')");
    app.js(
        "document.querySelector('#activity-target').value='pike';document.querySelector('#activity-method').value='fly'");
    app.clickReady("#activity-submit");
    app.waitFor(
        "document.querySelector('#confirmation').open &&"
            + " !document.querySelector('#confirmation-message').textContent.includes('Offline"
            + " smoke test')");
    app.clickReady("#confirmation-cancel");
    app.clickReady("#activity-submit");
    app.clickReady("#confirmation-accept");
    app.waitFor("!!document.querySelector('#withdraw-activity')");
    app.clickReady("#profile");
    app.clickReady("#my-activity");
    app.clickReady("#withdraw-0");
    app.clickReady("#confirmation-accept");
    app.waitFor(
        "document.querySelector('#screen').dataset.page==='myActivity' &&"
            + " !!document.querySelector('#back') && !document.querySelector('#withdraw-0')");
    app.clickReady("#tabtrips");
    app.clickReady("[data-trip]");
    app.waitFor("!!document.querySelector('#share-tip')");
  }
}
