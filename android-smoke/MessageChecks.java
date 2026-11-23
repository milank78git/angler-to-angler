package app.anglers.journal.smoke;

import java.io.IOException;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Private reply, receipt retry, recipient report and block actions through the Android transport.
 */
final class MessageChecks {
  static final String TOPIC = "01c121a2-a7e5-4512-af61-cf07a7f29141";
  static final String TITLE = "How was the north bank?";
  private static final String THREAD = "00e26dd1-b89b-4c71-acf6-744de7bca0be";
  private static final String BODY = "Private 🎣<reply> & details 👩🏽‍💻";
  private static final String TIME = "2026-11-23T10:00:00Z";
  private String request, reaction;
  private boolean blocked, reported;

  JSONObject response(String op, JSONObject args) throws Exception {
    JSONArray items = new JSONArray();
    JSONObject page = new JSONObject().put("next", JSONObject.NULL).put("items", items);
    switch (op) {
      case "message_inbox":
        if (request != null)
          items.put(
              new JSONObject()
                  .put("peerName", "Lake")
                  .put("postedAt", TIME)
                  .put("threadId", THREAD));
        return page;
      case "message_history":
        boolean topic = TOPIC.equals(args.optString("question_id"));
        if (!(topic && args.isNull("thread_id")
            || THREAD.equals(args.optString("thread_id")) && args.isNull("question_id")))
          throw new IOException("Wrong conversation");
        if (request != null) {
          items.put(
              new JSONObject()
                  .put("id", "2")
                  .put("mine", false)
                  .put("body", "Thanks!")
                  .put("myReaction", reaction == null ? JSONObject.NULL : reaction)
                  .put("peerReaction", "🐟")
                  .put("postedAt", TIME)
                  .put("reported", reported));
          items.put(
              new JSONObject()
                  .put("id", "1")
                  .put("mine", true)
                  .put("body", BODY)
                  .put("postedAt", TIME)
                  .put("questionText", TITLE));
        }
        return page.put("peerName", "Lake")
            .put("threadId", request == null ? JSONObject.NULL : THREAD)
            .put("questionText", topic ? TITLE : JSONObject.NULL)
            .put("canSend", !blocked)
            .put("blockedByMe", blocked);
      case "message_send":
        if (blocked
            || !args.isNull("thread_id")
            || !TOPIC.equals(args.getString("question_id"))
            || args.length() != 4
            || !BODY.equals(args.getString("message")))
          throw new IOException("Incorrect private reply");
        String token = args.getString("request_id");
        if (request == null) {
          request = token;
          throw new IOException("Lost private message receipt");
        }
        if (!request.equals(token)) throw new IOException("Duplicate on retry");
        return new JSONObject().put("threadId", THREAD).put("requestId", request);
      case "message_block":
        if (!THREAD.equals(args.getString("thread_id")))
          throw new IOException("Wrong block target");
        blocked = args.getBoolean("blocked");
        break;
      case "message_react":
        if (!THREAD.equals(args.getString("thread_id"))
            || !"2".equals(args.getString("message_id"))
            || blocked && !args.isNull("emoji"))
          throw new IOException("Unexpected reaction target");
        reaction = args.isNull("emoji") ? null : args.getString("emoji");
        return new JSONObject()
            .put("myReaction", reaction == null ? JSONObject.NULL : reaction)
            .put("peerReaction", "🐟");
      case "message_report":
        if (!THREAD.equals(args.getString("thread_id"))
            || !"2".equals(args.getString("message_id")))
          throw new IOException("Wrong report target");
        reported = true;
        break;
      default:
        throw new IOException("Unknown message RPC");
    }
    return new JSONObject();
  }

  private static void click(Runner app, String selector) throws Exception {
    app.js("document.querySelector(" + JSONObject.quote(selector) + ").click()");
  }

  private static void accept(Runner app, String selector) throws Exception {
    click(app, selector);
    app.waitFor("document.querySelector('#confirmation').open");
    click(app, "#confirmation-accept");
  }

  /** Enter on a foreign question in the feed and return to its water afterwards. */
  static void run(Runner app) throws Exception {
    click(app, "#discussion-items button");
    app.waitFor("!!document.querySelector('#private-reply')");
    click(app, "#private-reply");
    app.waitFor("document.querySelector('#message-tools')?.hidden===false");
    click(app, "#write-message");
    app.waitFor("!!document.querySelector('#message-text')");
    app.js(
        "var draftField=document.querySelector('#message-text');draftField.value="
            + JSONObject.quote(BODY.replace("🎣", ""))
            + ";draftField.setSelectionRange(8,8);document.querySelector('#inline-emoji').open=true");
    click(app, "#inline-emoji .emoji-choices button:nth-child(7)");
    app.waitFor("document.querySelector('#message-text').value===" + JSONObject.quote(BODY));
    click(app, "#message-form .savebar button");
    app.waitFor(
        "document.querySelector('#confirmation').open &&"
            + " document.querySelector('#confirmation-message').textContent==="
            + JSONObject.quote("Lake\n\n" + BODY));
    click(app, "#confirmation-cancel");
    app.waitFor("!document.querySelector('#confirmation').open");
    accept(app, "#message-form .savebar button");
    app.waitFor(
        "!!document.querySelector('#send-error')?.textContent &&"
            + " !document.querySelector('#message-text').disabled");
    accept(app, "#message-form .savebar button");
    app.waitFor(
        "document.querySelector('#message-items article:last-child"
            + " .discussion-body')?.textContent==="
            + JSONObject.quote(BODY));
    String picker = "#message-items article:first-child .message-reactions";
    click(app, picker + " summary");
    app.waitFor(
        "!!document.querySelector(" + JSONObject.quote(picker + " .emoji-choices button") + ")");
    click(app, picker + " .emoji-choices button");
    app.waitFor(
        "document.querySelector("
            + JSONObject.quote(picker + " p")
            + ").textContent.includes('👍')");
    click(app, picker + " summary");
    app.waitFor("!!document.querySelector(" + JSONObject.quote(picker + " input") + ")");
    app.js(
        "var reactionInput=document.querySelector("
            + JSONObject.quote(picker + " input")
            + ");reactionInput.value='👩🏽‍💻';reactionInput.dispatchEvent(new"
            + " KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
    app.waitFor(
        "document.querySelector("
            + JSONObject.quote(picker + " p")
            + ").textContent.includes('👩🏽‍💻')");
    accept(app, "#message-items .report-message");
    app.waitFor("document.querySelector('#message-items .report-message')?.disabled===true");
    accept(app, "#block-peer");
    app.waitFor(
        "document.querySelector('#message-tools')?.hidden===false &&"
            + " document.querySelector('#write-message').hidden");
    app.waitFor(
        "!document.querySelector("
            + JSONObject.quote(picker + " summary")
            + ") && document.querySelector("
            + JSONObject.quote(picker + " p")
            + ").textContent.includes('👩🏽‍💻')");
    click(app, picker + " button");
    app.waitFor(
        "!document.querySelector("
            + JSONObject.quote(picker + " p")
            + ").textContent.includes('👩🏽‍💻') && document.querySelector("
            + JSONObject.quote(picker + " p")
            + ").textContent.includes('🐟')");
    app.capture("blocked-private-conversation");
    click(app, "#profile");
    app.waitFor("!!document.querySelector('#private-inbox')");
    click(app, "#private-inbox");
    app.waitFor("!!document.querySelector('#message-items button')");
    click(app, "#message-items button");
    app.waitFor(
        "document.querySelector('#message-tools')?.hidden===false &&"
            + " document.querySelector('#write-message').hidden");
    accept(app, "#block-peer");
    app.waitFor(
        "document.querySelector('#message-tools')?.hidden===false &&"
            + " !document.querySelector('#write-message').hidden");
    // Unwind the profile/inbox visit and the original private reply route.
    for (String ready :
        new String[] {
          "!!document.querySelector('#inbox-refresh')",
          "!!document.querySelector('#private-inbox')",
          "document.querySelector('#message-tools')?.hidden===false",
          "!!document.querySelector('#private-reply')",
          "!!document.querySelector('#discussion-items button')",
          "!!document.querySelector('#open-rules')"
        }) {
      click(app, "#back");
      app.waitFor(ready);
    }
  }
}
