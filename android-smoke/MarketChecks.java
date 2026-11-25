package app.anglers.journal.smoke;

import java.io.IOException;
import org.json.JSONArray;
import org.json.JSONObject;

/** Exercise separate credit activation and explicit purchase through the Android account bridge. */
final class MarketChecks {
  private static final String ID = "06ff0538-e318-4fab-acfe-bc1f8fd30127";
  private static final String PLAY_ID = "98a88a6a-4a78-4dd9-993e-712b601a479e";
  private volatile boolean playOnline;
  private volatile boolean quoteAvailable;
  private boolean playPurchased;
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

  private JSONObject playOffer() throws Exception {
    return offer().put("id", PLAY_ID).put("title", "Limited Play tip").put("price", 6)
        .put("commercial", true).put("limit", 2).put("sold", playPurchased ? 2 : 1)
        .put("sales", playPurchased ? 1 : 0).put("pilotCopies", 1);
  }

  private JSONObject commerce(JSONObject request) throws Exception {
    if (!playOnline) throw new IOException("Simulated Play service outage");
    JSONObject args = request.getJSONObject("args");
    switch (request.getString("op")) {
      case "discover":
        return new JSONObject().put("items", new JSONArray().put(playOffer()))
            .put("stats", new JSONObject().put("offers",1).put("authors",1).put("sales",0).put("ratings",0));
      case "status":
        JSONObject wallet = new JSONObject().put("balance",11).put("mode","test")
            .put("earned",0).put("paid",0).put("pendingCredits",0).put("requested",0).put("published",1)
            .put("enrolled",PLAY_ID.equals(args.optString("offer")));
        if (quoteAvailable) wallet.put("welcomeBalance",10);
        return wallet;
      case "buy":
        if (!quoteAvailable || !PLAY_ID.equals(args.getString("offer")) || args.getInt("revision") != 2
            || args.getInt("price") != 6 || args.getInt("paid") != 1) throw new AssertionError("Wrong confirmed split");
        playPurchased = true;
        return new JSONObject();
      default: throw new AssertionError(request.getString("op"));
    }
  }

  JSONObject response(String op, JSONObject args) throws Exception {
    Object balance = activated ? (purchased ? 65 : 100) : JSONObject.NULL;
    switch (op) {
      case "commerce":
        return commerce(args);
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
        if (PLAY_ID.equals(args.getString("offer_id"))) {
          JSONObject detail = playOffer().put("mine",false).put("purchased",playPurchased);
          if (playPurchased) detail.put("technique","Paid technique").put("myRating",JSONObject.NULL);
          return detail;
        }
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

  void run(Runner app) throws Exception {
    app.clickReady("#tabwaters");
    app.clickReady("#home-market");
    app.clickReady("#market-create");
    app.waitFor("document.querySelector('#offer-country').value==='CZ'"
        + " && !!document.querySelector('#offer-species option[value=\"Esox lucius\"]')"
        + " && !document.querySelector('#offer-species option[value=\"Alepocephalus agassizii\"]')");
    app.clickReady("#back");
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
    app.waitFor("document.querySelector('#notice').textContent === "
        + org.json.JSONObject.quote(app.label("tip_ratings.could_not_confirm_submission_please_retry")));
    app.clickReady("#submit-rating");
    app.clickReady("#confirmation-accept");
    app.waitFor("document.querySelector('#my-rating dd')?.textContent==='5 / 5'");
    app.capture("purchased-tip-rating");
    app.clickReady("#back");
    app.clickReady("#shelf-purchased");
    app.clickReady("#offer-0");
    app.waitFor("!!document.querySelector('#my-rating') && !document.querySelector('#rating-form')"
        + " && !document.querySelector('#market-buy')");
    // Exercise the Play screen with failed commerce endpoints and a healthy purchased-content RPC.
    app.js("window.PlayMarket={refresh(){}}");
    try {
      app.clickReady("#back");
      app.clickReady("#shelf-browse");
      app.waitFor("!!document.querySelector('#market-reload')");
      app.clickReady("#shelf-purchased");
      app.waitFor("!!document.querySelector('#offer-0') && !document.querySelector('#market-activate')");
      app.clickReady("#offer-0");
      app.waitFor("document.querySelector('#market-technique')?.textContent==='The purchased technique'"
          + " && !document.querySelector('#market-buy')");
      playOnline = true;
      app.clickReady("#back");
      app.clickReady("#shelf-browse");
      app.clickReady("#offer-0");
      app.waitFor("!!document.querySelector('#wallet-refresh') && !document.querySelector('#market-buy')"
          + " && !document.querySelector('#market-activate')");
      quoteAvailable = true;
      app.clickReady("#wallet-refresh");
      app.clickReady("#market-buy");
      String split = app.label("commerce.purchase_funding").replace("{welcome}","5").replace("{paid}","1");
      app.waitFor("document.querySelector('#confirmation-message').textContent.includes(" + JSONObject.quote(split) + ")");
      app.clickReady("#confirmation-accept");
      app.waitFor("document.querySelector('#market-technique')?.textContent==='Paid technique'");
    } finally {
      app.js("delete window.PlayMarket");
    }
  }
}
