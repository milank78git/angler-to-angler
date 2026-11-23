package app.anglers.journal.smoke;

import java.io.IOException;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Exercise the public composer through WebView, the Android bridge and the test account transport.
 */
final class DiscussionChecks {
  private static final String QUESTION = "Which bank <today> & why?";
  private static final String ANSWER = "The west bank.";
  private final String neighbor = "ccd0a1e3-c131-4297-b3a9-5f6b87e0512a";
  private JSONObject question, answer;
  private boolean helpful, reported;

  private JSONObject card(String id, String text, boolean mine) throws Exception {
    return new JSONObject()
        .put("id", id)
        .put("body", text)
        .put("author", mine ? "River" : "Lake")
        .put("postedAt", "2026-06-02T18:04:00Z")
        .put("mine", mine);
  }

  JSONObject response(String operation, JSONObject body) throws Exception {
    if (!"CZ:401009".equals(body.getString("water_key"))) throw new IOException("Wrong water");
    switch (operation) {
      case "water_discussion":
        boolean thread = !body.isNull("question_id");
        JSONArray items = new JSONArray();
        if (thread) {
          if (!question.getString("id").equals(body.getString("question_id")))
            throw new IOException("Wrong thread");
          if (answer != null) items.put(answer);
          items.put(
              card(neighbor, "I fished the bend.", false)
                  .put("tripDay", "2026-05-10")
                  .put("helpful", helpful)
                  .put("reported", reported));
        } else if (question != null) items.put(question);
        return new JSONObject()
            .put("question", thread ? question : JSONObject.NULL)
            .put("items", items)
            .put("next", JSONObject.NULL);
      case "discussion_post":
        if (body.length() != 5) throw new IOException("Unexpected post fields");
        String id = body.getString("request_id");
        if (body.isNull("question_id")) {
          if (question == null) {
            if (!body.isNull("trip_day") || !QUESTION.equals(body.getString("message")))
              throw new IOException("Incorrect question");
            question = card(id, QUESTION, true).put("replyCount", 1);
            throw new IOException("Simulated loss of committed receipt");
          }
          if (!question.getString("id").equals(id))
            throw new IOException("Retry used a different ID");
        } else {
          if (!question.getString("id").equals(body.getString("question_id"))
              || !"2026-06-01".equals(body.getString("trip_day"))
              || !ANSWER.equals(body.getString("message")))
            throw new IOException("Incorrect answer");
          answer = card(id, ANSWER, true).put("tripDay", "2026-06-01");
        }
        return new JSONObject().put("id", id);
      case "discussion_helpful":
        if (!neighbor.equals(body.getString("answer_id")))
          throw new IOException("Wrong marked reply");
        helpful = body.getBoolean("marked");
        break;
      case "discussion_report":
        if (!neighbor.equals(body.getString("post_id")))
          throw new IOException("Wrong reported reply");
        reported = true;
        break;
      case "discussion_withdraw":
        if (!question.getString("id").equals(body.getString("post_id")))
          throw new IOException("Wrong withdrawal");
        question = null;
        answer = null;
        break;
      default:
        throw new IOException("Unexpected discussion operation");
    }
    return new JSONObject();
  }

  private static void click(Runner app, String selector) throws Exception {
    app.js("document.querySelector(" + JSONObject.quote(selector) + ").click()");
  }

  private static void postPreview(Runner app) throws Exception {
    click(app, "#discussion-form button");
    app.waitFor("document.querySelector('#confirmation').open");
  }

  static void run(Runner app) throws Exception {
    click(app, "#open-discussion");
    app.waitFor("document.querySelector('#discussion-tools')?.hidden===false");
    click(app, "#discussion-compose");
    app.waitFor("!!document.querySelector('#discussion-text')");
    app.js("document.querySelector('#discussion-text').value=" + JSONObject.quote(QUESTION));
    postPreview(app);
    click(app, "#confirmation-cancel");
    app.waitFor(
        "!document.querySelector('#confirmation').open &&"
            + " document.querySelector('#discussion-text').value==="
            + JSONObject.quote(QUESTION));
    postPreview(app);
    click(app, "#confirmation-accept");
    app.waitFor(
        "!!document.querySelector('#discussion-error')?.textContent &&"
            + " !document.querySelector('#discussion-text').disabled");
    postPreview(app);
    click(app, "#confirmation-accept");
    app.waitFor(
        "document.querySelector('#discussion-items .discussion-body')?.textContent==="
            + JSONObject.quote(QUESTION));
    click(app, "#discussion-items .actions button");
    app.waitFor(
        "document.querySelector('#discussion-root .discussion-body')?.textContent==="
            + JSONObject.quote(QUESTION));
    click(app, "#discussion-compose");
    app.waitFor("!!document.querySelector('#discussion-day')");
    app.js(
        "document.querySelector('#discussion-text').value="
            + JSONObject.quote(ANSWER)
            + ";document.querySelector('#discussion-day').value='2026-06-01'");
    postPreview(app);
    click(app, "#confirmation-accept");
    app.waitFor(
        "document.querySelector('#discussion-items .discussion-body')?.textContent==="
            + JSONObject.quote(ANSWER));
    click(app, "#discussion-items article:last-child .actions button:last-child");
    app.waitFor("!!document.querySelector('.discussion-helpful')");
    click(app, "#discussion-items article:last-child .actions button");
    app.waitFor("document.querySelector('#confirmation').open");
    click(app, "#confirmation-accept");
    app.waitFor("!!document.querySelector('#discussion-items article:last-child button:disabled')");
    app.capture("water-discussion");
    click(app, "#discussion-root .danger");
    app.waitFor("document.querySelector('#confirmation').open");
    click(app, "#confirmation-accept");
    app.waitFor(
        "document.querySelector('#discussion-tools')?.hidden===false &&"
            + " document.querySelector('#discussion-items').childElementCount===0");
    click(app, "#back");
    app.waitFor("!!document.querySelector('#open-rules')");
  }
}
