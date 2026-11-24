package app.anglers.journal.smoke;

import java.io.IOException;
import org.json.JSONArray;
import org.json.JSONObject;

/** Exercise separate credit activation and explicit purchase through the Android account bridge. */
final class MarketChecks {
  private static final String ID = "06ff0538-e318-4fab-acfe-bc1f8fd30127";
  private boolean activated;
  private boolean purchased;
  private JSONObject rating;

  private JSONObject offer() throws Exception {
    return new JSONObject()
        .put("id", ID).put("revision", 2).put("title", "River float")
        .put("species", "Carp").put("day", "2026-01-01").put("access", "shore")
        .put("price", 35).put("limit", 1).put("sold", purchased ? 1 : 0)
        .put("authorRating", new JSONObject().put("count", rating == null ? 0 : 1)
            .put("average", rating == null ? JSONObject.NULL : 4))
        .put("author", "Pilot angler").put("withdrawn", false);
  }

  JSONObject response(String op, JSONObject args) throws Exception {
    Object balance = activated ? (purchased ? 65 : 100) : JSONObject.NULL;
    switch (op) {
      case "market_discover":
        return new JSONObject().put("balance", balance).put("items", purchased ? new JSONArray() : new JSONArray().put(offer()))
            .put("stats",new JSONObject().put("offers",purchased ? 0 : 1).put("authors",purchased ? 0 : 1)
                .put("sales",0).put("ratings",0));
      case "market_list":
        JSONArray items = new JSONArray();
        if ((purchased ? "purchased" : "browse").equals(args.getString("shelf")))
          items.put(offer());
        return new JSONObject().put("items", items).put("balance", balance);
      case "market_detail":
        if (!ID.equals(args.getString("offer_id"))) throw new AssertionError("Wrong offer");
        JSONObject detail = offer().put("balance", balance).put("mine", false).put("purchased", purchased);
        if (purchased) detail.put("technique", "The purchased technique")
            .put("myRating", rating == null ? JSONObject.NULL : rating);
        return detail;
      case "market_activate":
        activated = true;
        return new JSONObject().put("balance", purchased ? 65 : 100);
      case "market_buy":
        if (!activated || !ID.equals(args.getString("offer_id")) || args.getInt("expected_price") != 35
            || args.getInt("expected_revision") != 2) throw new AssertionError("Unconfirmed terms");
        purchased = true;
        return new JSONObject().put("revision", 2);
      case "market_rate":
        if (!purchased || !ID.equals(args.getString("offer_id")) || args.length() != 4
            || args.getInt("accuracy") != 5 || args.getInt("technique") != 4
            || args.getInt("preview_match") != 3) throw new AssertionError("Wrong purchase rating");
        if (rating == null) {
          rating = new JSONObject().put("accuracy", 5).put("technique", 4).put("match", 3);
          throw new IOException("Simulated lost rating receipt");
        }
        return rating;
      default:
        throw new AssertionError(op);
    }
  }

  static void run(Runner app) throws Exception {
    app.clickReady("#tabwaters");
    app.clickReady("#home-market");
    app.clickReady("#offer-0");
    app.waitFor("!!document.querySelector('#market-activate') && !document.querySelector('#market-technique')");
    app.clickReady("#market-activate");
    app.clickReady("#market-buy");
    app.waitFor("document.querySelector('#confirmation-message').textContent.includes('35')");
    app.clickReady("#confirmation-cancel");
    app.waitFor("!!document.querySelector('#market-buy') && !document.querySelector('#market-technique')");
    app.clickReady("#market-buy");
    app.clickReady("#confirmation-accept");
    app.waitFor("document.querySelector('#market-technique')?.textContent==='The purchased technique'");
    app.capture("purchased-technique");
    app.clickReady("#rating-editor summary");
    app.waitFor("!document.querySelector('#rating-form').checkValidity()");
    app.clickReady("input[name=accuracy][value='5']");
    app.clickReady("input[name=technique][value='4']");
    app.clickReady("input[name=match][value='3']");
    app.clickReady("#submit-rating");
    app.waitFor("document.querySelector('#confirmation-message').textContent.includes('3/5')");
    app.clickReady("#confirmation-cancel");
    app.clickReady("#submit-rating");
    app.clickReady("#confirmation-accept");
    app.waitFor("/Odeslání|Could not confirm/.test(document.querySelector('#notice').textContent)");
    app.clickReady("#submit-rating");
    app.clickReady("#confirmation-accept");
    app.waitFor("document.querySelector('#my-rating dd')?.textContent==='5 / 5'");
    app.capture("purchased-tip-rating");
    app.clickReady("#back");
    app.clickReady("#shelf-purchased");
    app.clickReady("#offer-0");
    app.waitFor("!!document.querySelector('#my-rating') && !document.querySelector('#rating-form')"
        + " && !document.querySelector('#market-buy')");
  }
}
