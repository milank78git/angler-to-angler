package app.anglers.journal.smoke;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/**
 * Drives the actual onboarding screens. Only the test APK intercepts the synthetic account host.
 */
final class AccountChecks {
  private static final String ID = "11111111-1111-4111-8111-111111111111";
  private final ActivityChecks activityChecks = new ActivityChecks();
  private final WeeklyChecks weekly = new WeeklyChecks();
  private final MessageChecks messages = new MessageChecks();
  private final DiscussionChecks discussions = new DiscussionChecks();
  private final Runner app;
  private final boolean cs;
  private Activity gate;
  private volatile boolean accepted;
  private volatile String expectedChallenge;
  private volatile boolean socialEnabled;
  private volatile int sentEmails;
  private volatile boolean limitNextResend;
  private volatile boolean wrongEmail, expireGroupSession, retryGroup;
  private volatile int passwordSignIns, refreshes;
  private static final String PASSWORD = "fixture-password";
  private volatile String ownGroup;
  private volatile JSONObject savedCard;
  private volatile int cardRevision;
  private volatile JSONObject submittedCatch;
  private volatile JSONObject postedTip;
  private static final String INVITE = "d18590e4-a811-4937-a16f-8eb2dacc019d";

  /** Return the chosen database outcome on the next refresh of the submitted catch. */
  void setPhotoReview(String outcome, Integer lengthMm) throws Exception {
    submittedCatch =
        new JSONObject(submittedCatch.toString()).put("outcome", outcome).put("mm", lengthMm);
  }

  private JSONObject profile() throws Exception {
    return new JSONObject().put("id", ID).put("name", "River").put("current", true);
  }

  AccountChecks(Runner app, boolean cs) {
    this.app = app;
    this.cs = cs;
  }

  private String tr(String cz, String en) {
    return cs ? cz : en;
  }

  Activity register() throws Exception {
    URL.setURLStreamHandlerFactory(
        protocol ->
            "https".equals(protocol)
                ? new URLStreamHandler() {
                  @Override
                  protected URLConnection openConnection(URL u) throws IOException {
                    if (!"identity.angler.invalid".equals(u.getHost()))
                      throw new IOException("Unexpected test endpoint");
                    return new HttpURLConnection(u) {
                      final ByteArrayOutputStream request = new ByteArrayOutputStream();
                      String response = "";

                      @Override
                      public void connect() {}

                      @Override
                      public void disconnect() {}

                      @Override
                      public boolean usingProxy() {
                        return false;
                      }

                      @Override
                      public OutputStream getOutputStream() {
                        return request;
                      }

                      @Override
                      public int getResponseCode() throws IOException {
                        try {
                          if ("/auth/v1/settings".equals(u.getPath())
                              && "GET".equals(getRequestMethod())) {
                            response =
                                new JSONObject()
                                    .put(
                                        "external",
                                        new JSONObject()
                                            .put("google", socialEnabled)
                                            .put("email", true)
                                            .put("facebook", socialEnabled))
                                    .toString();
                            return 200;
                          }
                          JSONObject body = new JSONObject(request.toString("UTF-8"));
                          switch (u.getPath()) {
                            case "/auth/v1/token":
                              if ("grant_type=password".equals(u.getQuery())) {
                                if (!PASSWORD.equals(body.getString("password"))
                                    || !"test@example.invalid".equals(body.getString("email")))
                                  return 400;
                                passwordSignIns++;
                              } else if ("grant_type=refresh_token".equals(u.getQuery())) {
                                if (expireGroupSession
                                    || !"fixture-refresh".equals(body.getString("refresh_token")))
                                  return 400;
                                refreshes++;
                              } else {
                                byte[] hash =
                                    MessageDigest.getInstance("SHA-256")
                                        .digest(
                                            body.getString("code_verifier")
                                                .getBytes(StandardCharsets.US_ASCII));
                                String challenge =
                                    Base64.encodeToString(
                                        hash, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
                                if (!"grant_type=pkce".equals(u.getQuery())
                                    || !"fixture-code".equals(body.getString("auth_code"))
                                    || !challenge.equals(expectedChallenge)) return 403;
                              }
                              response =
                                  new JSONObject()
                                      .put("access_token", "fixture-session")
                                      .put("refresh_token", "fixture-refresh")
                                      .put("expires_in", 3600)
                                      .put(
                                          "user",
                                          new JSONObject()
                                              .put("id", ID)
                                              .put(
                                                  "email",
                                                  wrongEmail
                                                      ? "other@example.invalid"
                                                      : "test@example.invalid"))
                                      .toString();
                              return 200;
                            case "/auth/v1/user":
                              if (!"PUT".equals(getRequestMethod())
                                  || !PASSWORD.equals(body.getString("password"))
                                  || !"Bearer fixture-session"
                                      .equals(getRequestProperty("Authorization"))) return 403;
                              response = new JSONObject().put("id", ID).toString();
                              return 200;
                            case "/auth/v1/signup":
                              if (!PASSWORD.equals(body.getString("password"))
                                  || !(cs ? "cs" : "en")
                                      .equals(body.getJSONObject("data").getString("locale")))
                                return 400;
                            // Signup and recovery both bind their email link to the requesting
                            // phone.
                            case "/auth/v1/recover":
                              expectedChallenge = body.getString("code_challenge");
                              return acceptEmail(u, body);
                            case "/auth/v1/resend":
                              if (limitNextResend) {
                                limitNextResend = false;
                                return 429;
                              }
                              if (!"signup".equals(body.getString("type"))
                                  || body.has("password")
                                  || !body.getString("code_challenge").equals(expectedChallenge))
                                return 400;
                              return acceptEmail(u, body);
                            case "/rest/v1/rpc/angler_card":
                              JSONObject card =
                                  savedCard == null
                                      ? new JSONObject()
                                      : new JSONObject(savedCard.toString());
                              response =
                                  card.put("id", ID)
                                      .put("name", "River")
                                      .put("revision", cardRevision)
                                      .put("groups", new org.json.JSONArray())
                                      .put("verifiedCount", 0)
                                      .toString();
                              break;
                            case "/rest/v1/rpc/angler_save_card":
                              if (body.getInt("expected") != cardRevision
                                  || !body.getString("hometown").equals("Praha")) return 409;
                              if (cardRevision == 0
                                  && (body.getInt("avatar") != 50 || !body.getBoolean("shared")))
                                return 400;
                              if (cardRevision == 1
                                  && (body.getInt("avatar") != 0
                                      || !body.getString("photo").startsWith("/9j/"))) return 400;
                              if (cardRevision == 2
                                  && (!body.isNull("photo") || body.getBoolean("shared")))
                                return 400;
                              savedCard = body;
                              response =
                                  new JSONObject().put("revision", ++cardRevision).toString();
                              break;
                            case "/rest/v1/rpc/angler_evidence_list":
                              org.json.JSONArray items = new org.json.JSONArray();
                              if (submittedCatch != null) items.put(submittedCatch);
                              response =
                                  new JSONObject()
                                      .put("reviewer", false)
                                      .put("items", items)
                                      .put("more", false)
                                      .toString();
                              break;
                            case "/rest/v1/rpc/angler_evidence_submit":
                              if (!body.getString("photo").startsWith("/9j/")
                                  || body.getInt("lat100") != 5001
                                  || body.getInt("lon100") != 1412
                                  || body.getString("water").isEmpty()) return 400;
                              submittedCatch =
                                  new JSONObject()
                                      .put("id", body.getString("catch_id"))
                                      .put("species", body.getString("species"))
                                      .put("captured", body.getLong("captured"))
                                      .put("outcome", "pending");
                              response = new JSONObject().put("outcome", "pending").toString();
                              break;
                            case "/rest/v1/rpc/angler_evidence_remove":
                              if (submittedCatch == null
                                  || !submittedCatch
                                      .getString("id")
                                      .equals(body.getString("catch_id"))) return 404;
                              submittedCatch = null;
                              response = "{}";
                              break;
                            case "/rest/v1/rpc/angler_message_inbox":
                            case "/rest/v1/rpc/angler_message_history":
                            case "/rest/v1/rpc/angler_message_send":
                            case "/rest/v1/rpc/angler_message_report":
                            case "/rest/v1/rpc/angler_message_react":
                            case "/rest/v1/rpc/angler_message_block":
                              response =
                                  messages
                                      .response(
                                          u.getPath().substring("/rest/v1/rpc/angler_".length()),
                                          body)
                                      .toString();
                              break;
                            case "/rest/v1/rpc/angler_water_discussion":
                            case "/rest/v1/rpc/angler_discussion_post":
                            case "/rest/v1/rpc/angler_discussion_reply":
                            case "/rest/v1/rpc/angler_discussion_withdraw":
                            case "/rest/v1/rpc/angler_discussion_helpful":
                            case "/rest/v1/rpc/angler_discussion_report":
                              response =
                                  discussions
                                      .response(
                                          u.getPath().substring("/rest/v1/rpc/angler_".length()),
                                          body)
                                      .toString();
                              break;
                            case "/rest/v1/rpc/angler_activity_summary":
                            case "/rest/v1/rpc/angler_activity_state":
                            case "/rest/v1/rpc/angler_activity_change":
                            case "/rest/v1/rpc/angler_activity_mine":
                              response =
                                  activityChecks
                                      .response(
                                          u.getPath().substring("/rest/v1/rpc/angler_".length()),
                                          body)
                                      .toString();
                              break;
                            case "/rest/v1/rpc/angler_weekly_board":
                            case "/rest/v1/rpc/angler_weekly_enter":
                            case "/rest/v1/rpc/angler_weekly_report":
                            case "/rest/v1/rpc/angler_weekly_vote":
                            case "/rest/v1/rpc/angler_weekly_withdraw":
                              response =
                                  weekly
                                      .response(
                                          u.getPath().substring("/rest/v1/rpc/angler_".length()),
                                          body,
                                          ownGroup)
                                      .toString();
                              break;
                            case "/rest/v1/rpc/angler_groups":
                              if (expireGroupSession || retryGroup) {
                                retryGroup = false;
                                return 401;
                              }
                              org.json.JSONArray list = new org.json.JSONArray();
                              if (ownGroup != null)
                                list.put(
                                    new JSONObject()
                                        .put("id", ownGroup)
                                        .put("name", "River crew")
                                        .put("memberCount", 1)
                                        .put("owner", true));
                              response = new JSONObject().put("groups", list).toString();
                              break;
                            case "/rest/v1/rpc/angler_group_tip_post":
                              if (!body.getString("group_id").equals(ownGroup)
                                  || body.length() != 3
                                  || !body.getString("message")
                                      .startsWith("Fish the shade <slowly> & pause.")
                                  || body.getString("message").contains("Offline smoke test"))
                                return 400;
                              if (postedTip == null) {
                                postedTip = body;
                                return 503; // Commit applied; the client did not receive its
                                // receipt.
                              }
                              if (!postedTip
                                      .getString("request_id")
                                      .equals(body.getString("request_id"))
                                  || !postedTip
                                      .getString("message")
                                      .equals(body.getString("message"))) return 409;
                              response =
                                  new JSONObject()
                                      .put("id", body.getString("request_id"))
                                      .toString();
                              break;
                            case "/rest/v1/rpc/angler_group_tips":
                              if (!body.getString("group_id").equals(ownGroup)) return 403;
                              org.json.JSONArray tips = new org.json.JSONArray();
                              if (postedTip != null)
                                tips.put(
                                    new JSONObject()
                                        .put("text", postedTip.getString("message"))
                                        .put("author", "River")
                                        .put("postedAt", System.currentTimeMillis()));
                              response =
                                  new JSONObject()
                                      .put("tips", tips)
                                      .put("next", JSONObject.NULL)
                                      .toString();
                              break;
                            case "/rest/v1/rpc/angler_group_create":
                              if (!"River crew".equals(body.getString("group_name"))) return 400;
                              ownGroup =
                                  java.util.UUID.fromString(body.getString("group_id")).toString();
                              response = new JSONObject().put("id", ownGroup).toString();
                              break;
                            case "/rest/v1/rpc/angler_group_invite":
                              if (!body.getString("group_id").equals(ownGroup)) return 403;
                              response = new JSONObject().put("code", INVITE).toString();
                              break;
                            case "/rest/v1/rpc/angler_profile":
                              response = accepted ? profile().toString() : "null";
                              break;
                            case "/rest/v1/rpc/angler_accept":
                              if (!body.getString("nickname").equals("River")
                                  || !body.getString("terms").equals("2026-11-23")
                                  || !body.getString("privacy").equals("2026-11-23")) return 400;
                              response =
                                  new JSONObject()
                                      .put("id", ID)
                                      .put("name", "River")
                                      .put("current", true)
                                      .toString();
                              accepted = true;
                              break;
                            default:
                              return 404;
                          }
                          return "Bearer fixture-session"
                                  .equals(getRequestProperty("Authorization"))
                              ? 200
                              : 403;
                        } catch (Exception e) {
                          throw new IOException(e);
                        }
                      }

                      @Override
                      public InputStream getInputStream() {
                        return new ByteArrayInputStream(response.getBytes(StandardCharsets.UTF_8));
                      }
                    };
                  }
                }
                : null);
    Intent launch =
        app.getTargetContext()
            .getPackageManager()
            .getLaunchIntentForPackage(app.getTargetContext().getPackageName());
    gate = app.startActivitySync(launch);
    if (!find(app.expectedVersionLabel()).isShown())
      throw new AssertionError("Version hidden at sign-in");
    app.waitForIdleSync();
    TextView[] disabledGoogle = {null};
    app.runOnMainSync(
        () ->
            disabledGoogle[0] =
                match(
                    gate.findViewById(android.R.id.content),
                    tr("Pokračovat přes Google", "Continue with Google")));
    if (disabledGoogle[0] != null) throw new AssertionError("Disabled provider offered");
    app.captureAccount(gate, "login");
    click(tr("Podmínky a soukromí", "Terms and privacy"));
    click(tr("Ochrana osobních údajů", "Privacy notice"));
    TextView close = find(tr("Zavřít", "Close"));
    app.captureWindow(close.getRootView(), "privacy-dialog");
    click(tr("Zavřít", "Close"));
    requestRegistration();
    socialEnabled = true;
    click(tr("Zpět k přihlášení", "Back to sign-in"));
    find(tr("Pokračovat přes Google", "Continue with Google"));
    app.waitForIdleSync();
    app.captureAccount(gate, "login-social");
    checkSocialLogin("Facebook");
    checkSocialLogin("Google");
    click(tr("Nastavit nebo obnovit heslo", "Set or reset password"));
    type(tr("E-mail", "Email"), "test@example.invalid");
    click(tr("Poslat odkaz pro nastavení hesla", "Send password setup link"));
    find(tr("Otevřít poštu", "Open inbox"));
    requestAnotherLink();
    deliverCallback(Uri.parse(gate.getPackageName() + "://account/callback?code=fixture-code"));
    type(tr("Nové heslo", "New password"), PASSWORD);
    click(tr("Uložit heslo", "Save password"));
    find(tr("Přezdívka (2–60 znaků)", "Display name (2–60 characters)"));
    click(tr("Zpět k přihlášení", "Back to sign-in"));
    requestRegistration();
    app.captureAccount(gate, "inbox");
    Uri redirect = Uri.parse(gate.getPackageName() + "://account/callback");
    deliverCallback(redirect.buildUpon().appendQueryParameter("error_code", "otp_expired").build());
    find(
        tr(
            "Odkaz už byl použitý nebo vypršel. Nech si poslat nový.",
            "This link was already used or has expired. Request a new one."));
    limitNextResend = true;
    click(tr("Vyžádat nový odkaz", "Request another link"));
    find(
        tr(
            "Příliš mnoho pokusů. Zkus to za chvíli znovu.",
            "Too many attempts. Please try again later."));
    requestAnotherLink();
    wrongEmail = true;
    Uri success = redirect.buildUpon().appendQueryParameter("code", "fixture-code").build();
    deliverCallback(success);
    find(
        tr(
            "Akci se nepodařilo dokončit. Zkontroluj připojení nebo údaje a opakuj pokus.",
            "Could not complete this step. Check your connection or details, then retry."));
    wrongEmail = false;
    checkMailboxReturn();
    type(tr("Přezdívka (2–60 znaků)", "Display name (2–60 characters)"), "River");
    String save = tr("Uložit profil", "Save profile");
    assertDisabled(save);
    click(tr("Přijímám podmínky používání.", "I accept the terms of use."));
    assertDisabled(save);
    click(
        tr(
            "Seznámil/a jsem se s informacemi o zpracování údajů.",
            "I acknowledge the privacy notice."));
    Instrumentation.ActivityMonitor monitor =
        app.addMonitor("app.anglers.journal.FishingActivity", null, false);
    try {
      click(save);
      Activity journal = app.waitForMonitorWithTimeout(monitor, 15000);
      if (journal == null || !accepted)
        throw new AssertionError("Verified registration did not open journal");
      return journal;
    } finally {
      app.removeMonitor(monitor);
    }
  }

  private int acceptEmail(URL url, JSONObject body) throws Exception {
    String redirect = Uri.parse(url.toString()).getQueryParameter("redirect_to");
    if (!(app.getTargetContext().getPackageName() + "://account/callback").equals(redirect)
        || !body.getString("code_challenge").matches("[A-Za-z0-9_-]{43}")
        || !"s256".equals(body.getString("code_challenge_method"))
        || !"test@example.invalid".equals(body.getString("email"))) return 400;
    sentEmails++;
    return 200;
  }

  private void requestAnotherLink() throws Exception {
    int before = sentEmails;
    click(tr("Vyžádat nový odkaz", "Request another link"));
    find(
        tr(
            "O nový odkaz bylo požádáno. Zkontroluj poštu.",
            "New link requested. Check your inbox."));
    if (sentEmails != before + 1) throw new AssertionError("Expected exactly one new email");
  }

  /** Use a real second task for mail. Return via the launcher, then via a link from that task. */
  private void checkMailboxReturn() throws Exception {
    String open = tr("Otevřít poštu", "Open inbox");
    Instrumentation.ActivityMonitor mailbox =
        new Instrumentation.ActivityMonitor() {
          @Override
          public Instrumentation.ActivityResult onStartActivity(Intent intent) {
            Intent selector = intent.getSelector();
            if (selector == null || !selector.hasCategory(Intent.CATEGORY_APP_EMAIL)) return null;
            if ((intent.getFlags() & Intent.FLAG_ACTIVITY_NEW_TASK) == 0)
              throw new AssertionError("Inbox would open in the journal task");
            intent.setSelector(null);
            intent.setClassName(
                app.getContext().getPackageName(), TestInboxActivity.class.getName());
            intent.putExtra("targetPackage", gate.getPackageName());
            return null;
          }
        };
    app.addMonitor(mailbox);
    try {
      click(open);
      inboxLink();
      // Android applies background-launch restrictions to the journal while mail has focus.
      Intent launcher = gate.getPackageManager().getLaunchIntentForPackage(gate.getPackageName());
      String command =
          "am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER"
              + " -f 0x10200000 -n "
              + launcher.getComponent().flattenToShortString();
      try (InputStream output =
          new android.os.ParcelFileDescriptor.AutoCloseInputStream(
              app.getUiAutomation().executeShellCommand(command))) {
        byte[] buffer = new byte[512];
        while (output.read(buffer) != -1) {
          /* Wait for the launcher operation to finish. */
        }
      }
      awaitGateFocus();
      click(open);
      if (!inboxLink().performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK))
        throw new AssertionError("Could not open the link from the mailbox task");
      awaitGateFocus();
    } finally {
      app.removeMonitor(mailbox);
    }
  }

  private android.view.accessibility.AccessibilityNodeInfo inboxLink() throws Exception {
    for (int i = 0; i < 80; i++) {
      android.view.accessibility.AccessibilityNodeInfo root =
          app.getUiAutomation().getRootInActiveWindow();
      if (root != null
          && app.getContext()
              .getPackageName()
              .contentEquals(String.valueOf(root.getPackageName()))) {
        for (android.view.accessibility.AccessibilityNodeInfo button :
            root.findAccessibilityNodeInfosByText("Test email link"))
          if (button.isClickable()) return button;
      }
      Thread.sleep(100);
    }
    throw new AssertionError("Mailbox did not appear in the foreground");
  }

  private void awaitGateFocus() throws Exception {
    for (int i = 0; i < 80; i++) {
      boolean[] focused = {false};
      app.runOnMainSync(() -> focused[0] = gate.hasWindowFocus());
      if (focused[0]) return;
      Thread.sleep(100);
    }
    throw new AssertionError("Did not return to the original account screen");
  }

  /** Open groups from the journal, create a group, issue a code and renew its online session. */
  Activity groups() throws Exception {
    app.js("document.querySelector('#profile').click()");
    app.waitFor("!!document.querySelector('#edit-card')");
    app.js("document.querySelector('#edit-card').click()");
    app.waitFor("document.querySelectorAll('[name=portrait]').length===50");
    app.js(
        "document.querySelector('[name=portrait][value=\"50\"]').click();document.querySelector('#hometown').value='Praha';document.querySelector('#tagline').value='River"
            + " days';document.querySelector('#biography').value='Fishing since"
            + " 1998';document.querySelector('#shared').click();document.querySelector('#save-card').click()");
    app.waitFor(
        "document.querySelector('.angler-card')?.innerText.includes('Praha') &&"
            + " !!document.querySelector('.portrait-x9.portrait-y4')");
    app.waitFor(
        "document.querySelector('.profile-count h2')?.textContent === "
            + JSONObject.quote(tr("Úlovky doložené fotkou", "Photo-documented catches")));
    app.capture("profile-card");
    app.js("document.querySelector('#edit-card').click()");
    app.waitFor("!!document.querySelector('#profile-photo')");
    app.script("profile-photo.js");
    app.waitFor(
        "!!document.querySelector('#portrait-preview img') &&"
            + " !document.querySelector('#save-card').disabled");
    app.js("document.querySelector('#save-card').click()");
    app.waitFor("document.querySelector('.angler-card img')?.naturalWidth === 64");
    app.js("document.querySelector('#edit-card').click()");
    app.waitFor("!!document.querySelector('#clear-photo')");
    app.js(
        "document.querySelector('#clear-photo').click();document.querySelector('#shared').click();document.querySelector('#save-card').click()");
    app.waitFor(
        "!!document.querySelector('.angler-card .no-portrait') &&"
            + " !!document.querySelector('#account-settings')");
    if (cs) {
      app.js("document.querySelector('#theme').click()");
      app.waitFor("document.documentElement.dataset.theme === 'dark'");
    }
    gate =
        next(
            "AccountActivity", () -> app.js("document.querySelector('#account-settings').click()"));
    gate = next("GroupsActivity", () -> click(tr("Rybářské party", "Fishing groups")));
    String create = tr("Založit partu", "Create a group");
    click(create);
    type(tr("Název party (2–60 znaků)", "Group name (2–60 characters)"), "River crew");
    dialogButton(android.R.id.button1);
    find(tr("Počet členů: 1", "Members: 1"));
    app.captureAccount(gate, "groups");
    click("River crew" + tr(" · zakladatel", " · owner"));
    click(tr("Vystavit pozvánku", "Issue invitation"));
    TextView invitation = find(tr("Pozvánka pro jednoho rybáře", "Invite one angler"));
    app.captureWindow(invitation.getRootView(), "group-invitation");
    dialogButton(android.R.id.button2);
    click("River crew" + tr(" · zakladatel", " · owner"));
    click(tr("Rozpustit partu", "Dissolve group"));
    click(tr("Zrušit", "Cancel"));
    find(tr("Počet členů: 1", "Members: 1"));
    retryGroup = true;
    click(tr("Obnovit seznam", "Refresh groups"));
    find("River crew" + tr(" · zakladatel", " · owner"));
    if (refreshes != 1) throw new AssertionError("Expired access token was not refreshed");
    expireGroupSession = true;
    click(tr("Obnovit seznam", "Refresh groups"));
    find(tr("Přihlásit se", "Sign in"));
    // Reauthentication returns to the requested screen and the journal remains accessible.
    expireGroupSession = false;
    click(tr("Přihlásit se", "Sign in"));
    // CLEAR_TOP reuses the original profile activity.
    gate = profileGate;
    int emailsBefore = sentEmails;
    type(tr("E-mail", "Email"), "test@example.invalid");
    type(tr("Heslo", "Password"), PASSWORD);
    gate = next("GroupsActivity", () -> click(tr("Přihlásit se", "Sign in")));
    if (passwordSignIns != 1 || sentEmails != emailsBefore)
      throw new AssertionError("Routine sign-in sent email");
    find("River crew" + tr(" · zakladatel", " · owner"));
    app.runOnMainSync(gate::finish);
    gate = profileGate;
    return next("FishingActivity", () -> click(tr("Otevřít deník", "Open journal")));
  }

  /** Read the exact posted preview through the member's normal group screen. */
  void readGroupTip(String expected) throws Exception {
    if (postedTip == null || !expected.equals(postedTip.getString("message"))) {
      throw new AssertionError("Posted text differs from the preview");
    }
    app.js("document.querySelector('#profile').click()");
    app.waitFor("!!document.querySelector('#account-settings')");
    gate =
        next(
            "AccountActivity", () -> app.js("document.querySelector('#account-settings').click()"));
    gate = next("GroupsActivity", () -> click(tr("Rybářské party", "Fishing groups")));
    click("River crew" + tr(" · zakladatel", " · owner"));
    click(tr("Tipy party", "Group tips"));
    find(expected);
    app.captureAccount(gate, "group-tips");
    click(tr("Zpět na party", "Back to groups"));
    find("River crew" + tr(" · zakladatel", " · owner"));
  }

  private Activity profileGate;

  private interface Step {
    void run() throws Exception;
  }

  private Activity next(String name, Step step) throws Exception {
    Instrumentation.ActivityMonitor monitor =
        app.addMonitor("app.anglers.journal." + name, null, false);
    try {
      step.run();
      Activity next = app.waitForMonitorWithTimeout(monitor, 15000);
      if (next == null) throw new AssertionError("Activity did not open: " + name);
      if ("AccountActivity".equals(name)) profileGate = next;
      return next;
    } finally {
      app.removeMonitor(monitor);
    }
  }

  private void dialogButton(int id) {
    app.runOnMainSync(
        () -> {
          for (View root : android.view.inspector.WindowInspector.getGlobalWindowViews()) {
            View button = root.findViewById(id);
            if (button != null && button.isShown()) {
              button.performClick();
              return;
            }
          }
          throw new AssertionError("Missing dialog button");
        });
  }

  private void requestRegistration() throws Exception {
    click(tr("Vytvořit účet", "Create account"));
    type(tr("E-mail", "Email"), "test@example.invalid");
    type(tr("Nové heslo", "New password"), PASSWORD);
    click(tr("Zaregistrovat se", "Register"));
    find(tr("Otevřít poštu", "Open inbox"));
  }

  /**
   * Exercise both external browser requests and their native callbacks without a provider account.
   */
  private void checkSocialLogin(String provider) throws Exception {
    ArrayBlockingQueue<Uri> outgoing = new ArrayBlockingQueue<>(1);
    Instrumentation.ActivityMonitor browser =
        new Instrumentation.ActivityMonitor() {
          @Override
          public Instrumentation.ActivityResult onStartActivity(Intent intent) {
            Uri target = intent.getData();
            if (!Intent.ACTION_VIEW.equals(intent.getAction())
                || target == null
                || !"https".equals(target.getScheme())) return null;
            outgoing.offer(target);
            return new Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null);
          }
        };
    app.addMonitor(browser);
    Uri target;
    try {
      click(tr("Pokračovat přes ", "Continue with ") + provider);
      target = outgoing.poll(5, TimeUnit.SECONDS);
    } finally {
      app.removeMonitor(browser);
    }
    String pkg = gate.getPackageName();
    String redirect = pkg + "://account/callback";
    if (target == null
        || !"identity.angler.invalid".equals(target.getHost())
        || !"/auth/v1/authorize".equals(target.getPath())
        || !provider.equalsIgnoreCase(target.getQueryParameter("provider"))
        || !"s256".equalsIgnoreCase(target.getQueryParameter("code_challenge_method"))
        || (provider.equals("Google")
            && !"select_account".equals(target.getQueryParameter("prompt")))
        || !redirect.equals(target.getQueryParameter("redirect_to")))
      throw new AssertionError("Unexpected authorization request for " + provider);
    expectedChallenge = target.getQueryParameter("code_challenge");
    if (expectedChallenge == null || !expectedChallenge.matches("[A-Za-z0-9_-]{43}"))
      throw new AssertionError("Missing S256 challenge");
    deliverCallback(Uri.parse(redirect + "?code=fixture-code"));
    click(tr("Zpět k přihlášení", "Back to sign-in"));
    expectedChallenge = null;
  }

  private void deliverCallback(Uri uri) {
    Intent callback = new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE);
    app.runOnMainSync(() -> gate.startActivity(callback));
  }

  private void assertDisabled(String text) throws Exception {
    if (find(text).isEnabled()) throw new AssertionError("Premature profile acceptance");
  }

  private void click(String text) throws Exception {
    TextView v = find(text);
    app.runOnMainSync(
        () -> {
          for (ViewParent parent = v.getParent(); parent != null; parent = parent.getParent()) {
            if (parent instanceof AdapterView) {
              AdapterView<?> list = (AdapterView<?>) parent;
              int pos = list.getPositionForView(v);
              if (pos >= 0) {
                list.performItemClick(v, pos, list.getItemIdAtPosition(pos));
                return;
              }
            }
          }
          v.performClick();
        });
  }

  private void type(String hint, String value) throws Exception {
    EditText e = (EditText) find(hint);
    app.runOnMainSync(() -> e.setText(value));
  }

  private TextView find(String label) throws Exception {
    for (int i = 0; i < 80; i++) {
      TextView[] result = {null};
      app.runOnMainSync(
          () -> {
            for (View root : android.view.inspector.WindowInspector.getGlobalWindowViews()) {
              if (root.hasWindowFocus()) {
                result[0] = match(root, label);
                if (result[0] != null) return;
              }
            }
            result[0] = match(gate.findViewById(android.R.id.content), label);
          });
      if (result[0] != null) return result[0];
      Thread.sleep(100);
    }
    throw new AssertionError("Account control missing: " + label);
  }

  private TextView match(View view, String label) {
    if (view instanceof TextView) {
      TextView text = (TextView) view;
      if (label.contentEquals(text.getText()) || label.equals(String.valueOf(text.getHint())))
        return text;
    }
    if (view instanceof ViewGroup) {
      ViewGroup group = (ViewGroup) view;
      for (int i = 0; i < group.getChildCount(); i++) {
        TextView match = match(group.getChildAt(i), label);
        if (match != null) return match;
      }
    }
    return null;
  }
}
