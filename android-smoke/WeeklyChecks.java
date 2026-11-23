package app.anglers.journal.smoke;

import android.graphics.BitmapFactory;
import android.util.Base64;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Exercise image minimization, group selection, idempotent publication and voting through the
 * native bridge.
 */
final class WeeklyChecks {
  private static final String SAMPLE =
      "UklGRjwAAABXRUJQVlA4IDAAAAAwAgCdASoEAAMAAQAeJaACdLoB+AH4AARoAAD+3UR/909IQNH/MH/9tDOqEv9oAAA=";
  private static final String PEER = "a8b62b9d-062a-4f3b-a5d1-eb47ad7be568";
  private final LocalDate today = LocalDate.now(ZoneId.of("Europe/Prague"));
  private final LocalDate week = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
  private JSONObject published;
  private boolean voted, reported;

  private JSONObject card(boolean mine) throws Exception {
    return new JSONObject()
        .put("id", mine ? published.getString("request_id") : PEER)
        .put("author", mine ? "River" : "Lake")
        .put("species", mine ? "Perch" : "Pike")
        .put("photo", mine ? published.getString("photo") : SAMPLE)
        .put("day", today.toString())
        .put("score", !mine && voted ? 1 : 0)
        .put("voted", !mine && voted)
        .put("mine", mine)
        .put("place", mine && voted ? 2 : 1)
        .put("reported", !mine && reported);
  }

  JSONObject response(String op, JSONObject args, String group) throws Exception {
    if (group == null || !group.equals(args.getString("group_id")))
      throw new IOException("Wrong group");
    switch (op) {
      case "weekly_board":
        JSONArray entries = new JSONArray().put(card(false));
        if (published != null) entries.put(card(true));
        return new JSONObject()
            .put("week", week.toString())
            .put("today", today.toString())
            .put("open", true)
            .put("version", "weekly-fixture")
            .put("items", entries);
      case "weekly_enter":
        byte[] bytes = Base64.decode(args.getString("photo"), Base64.DEFAULT);
        String riff = new String(bytes, StandardCharsets.ISO_8859_1);
        if (args.length() != 6
            || !"Perch".equals(args.getString("species"))
            || !today.toString().equals(args.getString("catch_day"))
            || !riff.startsWith("RIFF")
            || !riff.substring(8, 16).equals("WEBPVP8 ")
            || riff.contains("private-gps-marker")
            || BitmapFactory.decodeByteArray(bytes, 0, bytes.length).getWidth() != 32)
          throw new IOException("Unexpected competition payload");
        if (published == null) {
          published = new JSONObject(args.toString());
          throw new IOException("Simulated receipt loss");
        }
        if (!published.getString("request_id").equals(args.getString("request_id"))
            || !published.getString("photo").equals(args.getString("photo")))
          throw new IOException("Different retry");
        return new JSONObject()
            .put("id", args.getString("request_id"))
            .put("week", week.toString());
      case "weekly_vote":
        if (!PEER.equals(args.getString("entry_id"))) throw new IOException("Wrong vote");
        voted = args.getBoolean("selected");
        break;
      case "weekly_report":
        if (!PEER.equals(args.getString("entry_id"))) throw new IOException("Wrong report");
        reported = true;
        break;
      case "weekly_withdraw":
        if (!published.getString("request_id").equals(args.getString("entry_id")))
          throw new IOException("Wrong withdrawal");
        published = null;
        break;
      default:
        throw new IOException("Unknown weekly RPC");
    }
    return new JSONObject();
  }

  private static void click(Runner app, String selector) throws Exception {
    String el = "document.querySelector(" + JSONObject.quote(selector) + ")";
    app.waitFor(
        "!!"
            + el
            + " && !"
            + el
            + ".disabled && "
            + el
            + ".getClientRects().length>0 &&"
            + " document.querySelector('#screen').getAttribute('aria-busy')!=='true'");
    app.js(el + ".click()");
  }

  static void run(Runner app) throws Exception {
    click(app, "#back");
    click(app, "[data-weekly-catch]");
    click(app, ".weekly-groups button");
    app.waitFor("document.querySelector('#entry-preview img')?.naturalWidth===32");
    click(app, "#weekly-enter");
    app.waitFor(
        "document.querySelector('#confirmation').open &&"
            + " document.querySelector('#confirmation-photo').src===document.querySelector('#entry-preview"
            + " img').src");
    click(app, "#confirmation-cancel");
    click(app, "#weekly-enter");
    click(app, "#confirmation-accept");
    app.waitFor(
        "!!document.querySelector('#weekly-enter') &&"
            + " !document.querySelector('#weekly-enter').disabled &&"
            + " !document.querySelector('#notice').hidden");
    click(app, "#weekly-enter");
    click(app, "#confirmation-accept");
    app.waitFor(
        "document.querySelectorAll('.weekly-entry').length===2 &&"
            + " !document.querySelector('#weekly-enter')");
    click(app, "[data-weekly-action=vote]");
    app.waitFor(
        "document.querySelector('[data-weekly-action=vote]')?.getAttribute('aria-pressed')==='true'");
    app.capture("group-catch-of-the-week");
    click(app, "[data-weekly-action=vote]");
    app.waitFor(
        "document.querySelector('[data-weekly-action=vote]')?.getAttribute('aria-pressed')==='false'");
    click(app, "[data-weekly-action=withdraw]");
    click(app, "#confirmation-accept");
    app.waitFor(
        "document.querySelectorAll('.weekly-entry').length===1 &&"
            + " !document.querySelector('[data-weekly-action=withdraw]')");
    click(app, "#profile");
    click(app, "#weekly-groups");
    click(app, ".weekly-groups button");
    app.waitFor("document.querySelector('.weekly-entry img')?.naturalWidth===4");
  }
}
