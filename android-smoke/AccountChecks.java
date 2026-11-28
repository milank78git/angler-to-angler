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
  private final AtlasFixture atlas = new AtlasFixture();
  final MarketChecks market = new MarketChecks();
  private final PublicCardChecks publicCards;
  private final ActivityChecks activityChecks = new ActivityChecks();
  private final WeeklyChecks weekly = new WeeklyChecks();
  private final MessageChecks messages = new MessageChecks();
  private final DiscussionChecks discussions = new DiscussionChecks();
  private static final String REPORT_WATER = "CZ:CRS:4615417";
  private boolean ownWaterReport, failNextReportRead;
  private final Runner app;
  private final boolean cs;
  private Activity gate;
  private volatile boolean accepted;
  private volatile String expectedChallenge;
  private volatile boolean socialEnabled;
  private volatile int sentEmails;
  private volatile boolean limitNextResend;
  volatile String nextEvidenceLimit;
  private volatile boolean wrongEmail, expireGroupSession, retryGroup;
  private volatile int passwordSignIns, refreshes;
  private static final String PASSWORD = "fixture-password";
  private volatile String ownGroup;
  private volatile boolean rosterMember, invitationRevoked;
  private static final String ROSTER_ID = "71111111-6111-4111-8111-111111111111";
  private volatile JSONObject savedCard;
  private volatile int cardRevision;
  private JSONObject privateDetails;
  private volatile JSONObject submittedCatch;
  private volatile JSONObject postedTip;
  private static final String INVITE = "d18590e4-a811-4937-a16f-8eb2dacc019d";

  /** Return the chosen database outcome on the next refresh of the submitted catch. */
  void setPhotoReview(String outcome, Integer lengthMm) throws Exception {
    submittedCatch =
        new JSONObject(submittedCatch.toString()).put("outcome", outcome).put("mm", lengthMm);
  }

  private JSONObject profile() throws Exception {
    return new JSONObject().put("id", ID).put("name", "River").put("ageBand", "adult").put("current", true);
  }

  AccountChecks(Runner app, boolean cs) {
    this.app = app;
    publicCards = new PublicCardChecks(app.waterName("401009"));
    this.cs = cs;
  }

  private String tr(String key) {
    return app.label(key);
  }

  Activity register() throws Exception {
    URL.setURLStreamHandlerFactory(
        protocol ->
            "https".equals(protocol)
                ? new URLStreamHandler() {
                  @Override
                  protected URLConnection openConnection(URL u) throws IOException {
                    if ("raw.githubusercontent.com".equals(u.getHost())) return atlas.download(u);
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
                            case "/rest/v1/rpc/angler_watch_favourites":
                              if (!"Bearer fixture-session".equals(getRequestProperty("Authorization"))) return 401;
                              java.util.UUID.fromString(body.getString("device_key"));
                              response = new JSONObject().put("position","7").put("water","CZ:401009").toString();
                              return 200;
                            case "/rest/v1/rpc/angler_end_post_watch":
                              java.util.UUID.fromString(body.getString("device_key"));
                              response = "{}";
                              return 200;
                            case "/rest/v1/rpc/angler_water_manifest":
                              response = atlas.manifest;
                              return 200;
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
                                  || !(cs ? "cs-cz" : "en-gb")
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
                            case "/rest/v1/rpc/angler_my_details":
                              if (privateDetails == null) privateDetails = new JSONObject()
                                  .put("age",48).put("expiry",JSONObject.NULL).put("reminder","off").put("revision",0);
                              JSONObject changes = body.optJSONObject("changes");
                              if (changes != null) {
                                if (changes.getInt("revision") != privateDetails.getInt("revision")) return 409;
                                privateDetails = changes.put("revision", changes.getInt("revision")+1);
                              }
                              response = privateDetails.toString();
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
                              if (nextEvidenceLimit != null) {
                                response = new JSONObject().put("code","PT429").put("message",nextEvidenceLimit).toString();
                                nextEvidenceLimit = null;
                                return 429;
                              }
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
                            case "/rest/v1/rpc/angler_water_report":
                              if (!REPORT_WATER.equals(body.getString("water_key"))
                                  || !"low_water".equals(body.getString("kind"))
                                  || ownWaterReport != body.getBoolean("withdraw")) return 422;
                              ownWaterReport = !ownWaterReport;
                              failNextReportRead = ownWaterReport;
                              response = "";
                              break;
                            case "/rest/v1/rpc/angler_water_alerts":
                              response = "{}";
                              if (REPORT_WATER.equals(body.getString("water_key"))) {
                                if (failNextReportRead) {
                                  failNextReportRead = false;
                                  return 503;
                                }
                                if (ownWaterReport) response = new JSONObject()
                                    .put("low_water", new JSONObject().put("count", 1).put("mine", true))
                                    .toString();
                              }
                              break;
                            case "/rest/v1/rpc/angler_commerce":
                            case "/rest/v1/rpc/angler_market_discover":
                            case "/rest/v1/rpc/angler_market_list":
                            case "/rest/v1/rpc/angler_market_detail":
                            case "/rest/v1/rpc/angler_market_activate":
                            case "/rest/v1/rpc/angler_market_buy":
                            case "/rest/v1/rpc/angler_market_rate":
                              response = market.response(u.getPath().substring("/rest/v1/rpc/angler_".length()), body).toString();
                              break;
                            case "/rest/v1/rpc/angler_public_card_options":
                            case "/rest/v1/rpc/angler_public_card_publish":
                            case "/rest/v1/rpc/angler_public_card_withdraw":
                            case "/rest/v1/rpc/angler_public_cards":
                              response =
                                  publicCards
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
                                        .put("memberCount", rosterMember ? 2 : 1)
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
                            case "/rest/v1/rpc/angler_group_members":
                              if (!body.getString("group_id").equals(ownGroup)) return 403;
                              org.json.JSONArray roster = new org.json.JSONArray();
                              if (rosterMember) roster.put(new JSONObject().put("id", ROSTER_ID).put("name","Lake visitor"));
                              response = new JSONObject().put("items",roster).put("ownerName","River").put("next",JSONObject.NULL).toString();
                              break;
                            case "/rest/v1/rpc/angler_group_remove_member":
                              if (!body.getString("group_id").equals(ownGroup) || !ROSTER_ID.equals(body.getString("member_id"))) return 403;
                              rosterMember = false;
                              response = "{}";
                              break;
                            case "/rest/v1/rpc/angler_group_revoke":
                              if (!body.getString("group_id").equals(ownGroup)) return 403;
                              invitationRevoked = true;
                              response = "{}";
                              break;
                            case "/rest/v1/rpc/angler_group_link":
                              if (!body.getString("group_id").equals(ownGroup)) return 403;
                              response = new JSONObject().put("code", INVITE).toString();
                              break;
                            case "/rest/v1/rpc/angler_registration_profile":
                            case "/rest/v1/rpc/angler_profile":
                              response = accepted ? profile().toString() : "null";
                              break;
                            case "/rest/v1/rpc/angler_register":
                              if ("\u0392ob Kemp".equals(body.getString("nickname"))) {
                                response = new JSONObject().put("code", "AN003").toString();
                                return 400;
                              }
                              if (!body.getString("birth_date").equals("1978-01-01") || !body.getString("nickname").equals("River")
                                  || !body.getString("terms").equals("2026-11-26.2")
                                  || !body.getString("privacy").equals("2026-11-26.2")) return 400;
                              response =
                                  new JSONObject()
                                      .put("id", ID)
                                      .put("name", "River")
                                      .put("ageBand", "adult").put("current", true)
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
                      public InputStream getErrorStream() {
                        return new ByteArrayInputStream(response.getBytes(StandardCharsets.UTF_8));
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
    // Observe the real account screen behind the public, no-display launcher.
    Instrumentation.ActivityMonitor loginMonitor = app.addMonitor("app.anglers.journal.AccountActivity", null, false);
    app.getTargetContext().startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    gate = app.waitForMonitorWithTimeout(loginMonitor, 10000);
    app.removeMonitor(loginMonitor);
    if (gate == null) throw new AssertionError("Launcher did not open account");
    if (!find(app.expectedVersionLabel()).isShown())
      throw new AssertionError("Version hidden at sign-in");
    app.waitForIdleSync();
    TextView[] disabledGoogle = {null};
    app.runOnMainSync(
        () ->
            disabledGoogle[0] =
                match(
                    gate.findViewById(android.R.id.content),
                    tr("account.continue_with") + "Google"));
    if (disabledGoogle[0] != null) throw new AssertionError("Disabled provider offered");
    app.captureAccount(gate, "login");
    click(tr("common.explain") + " · " + tr("account.email"));
    find(tr("account.enter_the_email_address_for_your_account"));
    click(tr("common.close"));
    click(tr("common.help"));
    find(tr("common.close"));
    click(tr("common.close"));
    click(tr("account.terms_and_privacy"));
    click(tr("account.privacy_notice"));
    TextView close = find(tr("common.close"));
    app.captureWindow(close.getRootView(), "privacy-dialog");
    click(tr("common.close"));
    requestRegistration();
    socialEnabled = true;
    click(tr("account.confirmed_sign_in"));
    click(tr("account.return_to_confirmation"));
    find(tr("account.open_inbox"));
    click(tr("account.confirmed_sign_in"));
    find(tr("account.continue_with") + "Google");
    app.waitForIdleSync();
    app.captureAccount(gate, "login-social");
    checkSocialLogin("Facebook");
    checkSocialLogin("Google");
    click(tr("account.set_or_reset_password"));
    type(tr("account.email"), "test@example.invalid");
    click(tr("account.send_password_setup_link"));
    find(tr("account.open_inbox"));
    requestAnotherLink();
    deliverCallback(Uri.parse(gate.getPackageName() + "://account/callback?code=fixture-code"));
    type(tr("account.new_password"), PASSWORD);
    click(tr("account.save_password"));
    find(tr("account.display_name_2_60_characters"));
    click(tr("account.back_to_sign_in"));
    requestRegistration();
    app.captureAccount(gate, "inbox");
    Uri redirect = Uri.parse(gate.getPackageName() + "://account/callback");
    deliverCallback(redirect.buildUpon().appendQueryParameter("error_code", "otp_expired").build());
    find(
        tr("account.this_link_was_already_used_or_has"));
    limitNextResend = true;
    click(tr("account.request_another_link"));
    find(
        tr("account.too_many_attempts_please_try_again_later"));
    requestAnotherLink();
    wrongEmail = true;
    Uri success = redirect.buildUpon().appendQueryParameter("code", "fixture-code").build();
    deliverCallback(success);
    find(
        tr("account.could_not_complete_this_step_check_your"));
    wrongEmail = false;
    checkMailboxReturn();
    type(tr("account.display_name_2_60_characters"), "\u0392ob Kemp");
    type(tr("age.birth_date"), "1978-01-01");
    String save = tr("common.save_profile");
    assertDisabled(save);
    click(tr("account.i_accept_the_terms_of_use"));
    assertDisabled(save);
    click(
        tr("account.i_acknowledge_the_privacy_notice"));
    Instrumentation.ActivityMonitor monitor =
        app.addMonitor("app.anglers.journal.FishingActivity", null, false);
    try {
      click(save);
      int years = java.time.Period.between(java.time.LocalDate.of(1978, 1, 1),
          java.time.LocalDate.now(java.time.ZoneId.of("Europe/Prague"))).getYears();
      find(tr("age.review_date").replace("{date}", "1978-01-01").replace("{age}", Integer.toString(years)));
      click(tr("common.cancel"));
      if (accepted) throw new AssertionError("Cancelled birth-date review registered the profile");
      click(save);
      click(tr("age.confirm_date"));
      find(tr("account.mixed_script_name"));
      type(tr("account.display_name_2_60_characters"), "River");
      click(save);
      click(tr("age.confirm_date"));
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
    click(tr("account.request_another_link"));
    find(
        tr("account.new_link_requested_check_your_inbox"));
    if (sentEmails != before + 1) throw new AssertionError("Expected exactly one new email");
  }

  /** Use a real second task for mail. Return via the launcher, then via a link from that task. */
  private void checkMailboxReturn() throws Exception {
    String open = tr("account.open_inbox");
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
    app.clickReady("#profile");
    app.waitFor("!!document.querySelector('#edit-card')");
    app.js("document.querySelector('#edit-card').click()");
    app.waitFor("document.querySelectorAll('[name=portrait]').length===50");
    app.js("const town=document.querySelector('#hometown');town.value='Unsaved';"
        + "town.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#reload-card').click()");
    app.clickReady("#confirmation-cancel");
    app.waitFor("document.querySelector('#hometown').value==='Unsaved'");
    app.clickReady("#reload-card");
    app.clickReady("#confirmation-accept");
    app.waitFor("document.querySelector('#hometown')?.value===''");

    app.js(
        "document.querySelector('[name=portrait][value=\"50\"]').click();document.querySelector('#hometown').value='Praha';document.querySelector('#tagline').value='River"
            + " days';document.querySelector('#biography').value='Fishing since"
            + " 1998';document.querySelector('#shared').click();document.querySelector('#save-card').click()");
    app.waitFor(
        "document.querySelector('.angler-card')?.innerText.includes('Praha') &&"
            + " !!document.querySelector('.portrait-x9.portrait-y4')");
    app.waitFor(
        "document.querySelector('.profile-count h2')?.textContent === "
            + JSONObject.quote(tr("profiles.photo_documented_catches")));
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
    gate = next("GroupsActivity", () -> click(tr("common.fishing_groups")));
    String create = tr("groups.create_a_group");
    click(create);
    type(tr("groups.group_name_2_60_characters"), "River crew");
    dialogButton(android.R.id.button1);
    find(tr("groups.members") + "1");
    app.captureAccount(gate, "groups");
    click("River crew" + tr("groups.owner"));
    click(tr("groups.issue_invitation"));
    TextView invitation = find(tr("groups.the_code_lasts_24_hours_a_new"));
    app.captureWindow(invitation.getRootView(), "group-invitation");
    dialogButton(android.R.id.button2);
    click("River crew" + tr("groups.owner"));
    rosterMember = true;
    click(tr("public_cards.revoke_link"));
    dialogButton(android.R.id.button1);
    find(tr("groups.members") + "2");
    if (!invitationRevoked) throw new AssertionError("Invitation was not revoked");
    click("River crew" + tr("groups.owner"));
    click(tr("groups.member_list"));
    find(tr("groups.member_list") + " · River crew");
    click("Lake visitor");
    find(tr("groups.remove_member_confirm"));
    find(tr("groups.remove_member"));
    dialogButton(android.R.id.button1);
    find(tr("groups.members") + "1");
    if (rosterMember) throw new AssertionError("Member was not removed");
    click(tr("groups.back_to_groups"));
    click("River crew" + tr("groups.owner"));
    click(tr("groups.dissolve_group"));
    click(tr("common.cancel"));
    find(tr("groups.members") + "1");
    retryGroup = true;
    click(tr("groups.refresh_groups"));
    find("River crew" + tr("groups.owner"));
    if (refreshes != 1) throw new AssertionError("Expired access token was not refreshed");
    expireGroupSession = true;
    click(tr("groups.refresh_groups"));
    find(tr("common.sign_in"));
    // Reauthentication returns to the requested screen and the journal remains accessible.
    expireGroupSession = false;
    click(tr("common.sign_in"));
    // CLEAR_TOP reuses the original profile activity.
    gate = profileGate;
    int emailsBefore = sentEmails;
    type(tr("account.email"), "test@example.invalid");
    type(tr("account.password"), PASSWORD);
    gate = next("GroupsActivity", () -> click(tr("common.sign_in")));
    if (passwordSignIns != 1 || sentEmails != emailsBefore)
      throw new AssertionError("Routine sign-in sent email");
    find("River crew" + tr("groups.owner"));
    app.runOnMainSync(gate::finish);
    gate = profileGate;
    return next("FishingActivity", () -> click(tr("account.open_journal")));
  }

  /** Read the exact posted preview through the member's normal group screen. */
  void readGroupTip(String expected) throws Exception {
    if (postedTip == null || !expected.equals(postedTip.getString("message"))) {
      throw new AssertionError("Posted text differs from the preview");
    }
    app.clickReady("#profile");
    app.waitFor("!!document.querySelector('#account-settings')");
    gate =
        next(
            "AccountActivity", () -> app.js("document.querySelector('#account-settings').click()"));
    gate = next("GroupsActivity", () -> click(tr("common.fishing_groups")));
    click("River crew" + tr("groups.owner"));
    click(tr("groups.group_tips"));
    find(expected);
    app.captureAccount(gate, "group-tips");
    click(tr("groups.back_to_groups"));
    find("River crew" + tr("groups.owner"));
  }

  /** Exercise foreground renewal and force an expired lease while a real trip form is open. */
  void checkJournalLease() throws Exception {
    android.content.SharedPreferences preferences = app.getTargetContext()
        .getSharedPreferences("angler-account", android.content.Context.MODE_PRIVATE);
    Activity settings = next("WaterSettingsActivity", () -> app.js("window.Device.openWaterSettings()"));
    long now = System.currentTimeMillis();
    preferences.edit().putLong("verified", now - java.util.concurrent.TimeUnit.DAYS.toMillis(3)).commit();
    app.runOnMainSync(settings::finish);
    long timeout = android.os.SystemClock.elapsedRealtime() + 15000;
    while (preferences.getLong("verified", 0) < now && android.os.SystemClock.elapsedRealtime() < timeout)
      Thread.sleep(100);
    if (preferences.getLong("verified", 0) < now)
      throw new AssertionError("Resuming the journal did not renew the offline lease");
    // Older builds stored zero when an online profile or terms check invalidated the lease.
    Activity review = next("WaterSettingsActivity", () -> app.js("window.Device.openWaterSettings()"));
    preferences.edit().putLong("verified", 0).commit();
    gate = next("AccountActivity", () -> app.runOnMainSync(review::finish));
    find(tr("account.review_profile"));
    type(tr("account.email"), "test@example.invalid");
    type(tr("account.password"), PASSWORD);
    click(tr("common.sign_in"));
    app.waitForJournalWindow();
    Activity reopened = next("WaterSettingsActivity", () -> app.js("window.Device.openWaterSettings()"));
    preferences.edit().putLong("verified", now - java.util.concurrent.TimeUnit.DAYS.toMillis(8)).commit();
    gate = next("AccountActivity", () -> app.runOnMainSync(reopened::finish));
    find(tr("account.offline_expired"));
    type(tr("account.email"), "test@example.invalid");
    type(tr("account.password"), PASSWORD);
    click(tr("common.sign_in"));
    app.waitForJournalWindow();
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
    click(tr("account.create_account"));
    type(tr("account.email"), "test@example.invalid");
    type(tr("account.new_password"), PASSWORD);
    click(tr("account.register"));
    find(tr("account.open_inbox"));
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
      click(tr("account.continue_with") + provider);
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
    click(tr("account.back_to_sign_in"));
    expectedChallenge = null;
  }

  private void deliverCallback(Uri uri) {
    Intent callback = new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE);
    app.runOnMainSync(() -> gate.startActivity(callback));
  }

  /** Exercise the private profile form, an immediately due Android notification and cancellation. */
  void fishingLicence() throws Exception {
    app.clickReady("#profile");
    app.clickReady("#private-details");
    app.waitFor("!!document.querySelector('#angler-age')");
    String expiry = java.time.LocalDate.now().plusDays(5).toString();
    app.waitFor("document.querySelector('#angler-age').readOnly && document.querySelector('#angler-age').value==='48'");
    app.setControl("#permit-expiry", expiry, "input");
    app.setControl("#permit-lead", "week", "change");
    app.clickReady("#details-form button[type=submit]");
    app.waitFor("document.querySelector('#private-summary')?.textContent.includes('48') && !document.querySelector('#license-notice').hidden");
    android.app.NotificationManager manager = app.getTargetContext().getSystemService(android.app.NotificationManager.class);
    if (java.util.Arrays.stream(manager.getActiveNotifications()).noneMatch(n -> "fishing-license".equals(n.getNotification().getChannelId())))
      throw new AssertionError("No fishing licence notification");
    app.clickReady("#license-notice");
    app.waitFor("document.querySelector('#permit-expiry')?.value==='" + expiry + "'");
    app.setControl("#permit-expiry", "", "input");
    app.clickReady("#details-form button[type=submit]");
    app.waitFor("!!document.querySelector('#private-summary') && document.querySelector('#license-notice').hidden");
    if (java.util.Arrays.stream(manager.getActiveNotifications()).anyMatch(n -> "fishing-license".equals(n.getNotification().getChannelId())))
      throw new AssertionError("Clearing expiry kept a notification");
    app.clickReady("#tabwaters");
  }

  /** Select an item in the actual native single-choice list, including rows outside its viewport. */
  void pickLanguage(String buttonLabel, String option) throws Exception {
    click(buttonLabel);
    app.waitForIdleSync();
    boolean[] chosen = {false};
    app.runOnMainSync(() -> {
      for (View root : android.view.inspector.WindowInspector.getGlobalWindowViews()) {
        if (!root.hasWindowFocus()) continue;
        ListView list = languageList(root);
        if (list == null) continue;
        for (int i=0; i<list.getCount(); i++) {
          if (option.contentEquals(String.valueOf(list.getItemAtPosition(i)))) {
            chosen[0] = list.performItemClick(null,i,list.getItemIdAtPosition(i));
            return;
          }
        }
      }
    });
    if (!chosen[0]) throw new AssertionError("Language option missing: " + option);
  }

  private ListView languageList(View root) {
    if (root instanceof ListView) return (ListView)root;
    if (root instanceof ViewGroup) {
      ViewGroup group = (ViewGroup)root;
      for (int i=0; i<group.getChildCount(); i++) {
        ListView child = languageList(group.getChildAt(i));
        if (child != null) return child;
      }
    }
    return null;
  }

  void atlasSettings() throws Exception {
    app.clickReady("#atlas-settings");
    String daily = tr("atlas_settings.check_automatically_every_day");
    for (String option : new String[]{"alerts.posts","alerts.community","alerts.waters","alerts.nearby","settings.large","settings.screen_on"}) {
      if (((CheckBox)find(tr(option))).isChecked()) throw new AssertionError("Unexpected default for " + option);
    }
    android.content.Context target = app.getTargetContext();
    app.getUiAutomation().grantRuntimePermission(target.getPackageName(), android.Manifest.permission.POST_NOTIFICATIONS);
    click(tr("alerts.posts"));
    android.content.SharedPreferences alerts = target.getSharedPreferences("field-alerts", 0);
    long activation = android.os.SystemClock.elapsedRealtime() + 10000;
    while (!alerts.contains("cursor") && android.os.SystemClock.elapsedRealtime() < activation) Thread.sleep(100);
    if (alerts.getLong("cursor", -1) != 7) throw new AssertionError("Post subscription did not establish its baseline");
    android.app.job.JobScheduler jobs = target.getSystemService(android.app.job.JobScheduler.class);
    if (jobs.getAllPendingJobs().stream().noneMatch(j -> j.getService().getClassName().endsWith(".FieldAlertJob") && j.isPersisted()
        && j.getIntervalMillis() == TimeUnit.HOURS.toMillis(1))) throw new AssertionError("Hourly post check unavailable");
    click(tr("alerts.posts"));
    if (alerts.contains("key") || jobs.getAllPendingJobs().stream().anyMatch(j -> j.getService().getClassName().endsWith(".FieldAlertJob")))
      throw new AssertionError("Post subscription survived switching off");
    click(tr("settings.screen_on"));
    click(tr("settings.large"));
    app.waitForIdleSync();
    click(tr("common.back"));
    app.waitForIdleSync();
    int expectedZoom = Math.round(130 * target.getResources().getConfiguration().fontScale);
    long zoomDeadline = android.os.SystemClock.elapsedRealtime() + 6000;
    while (app.textZoom() != expectedZoom && android.os.SystemClock.elapsedRealtime() < zoomDeadline) Thread.sleep(100);
    if (app.textZoom() != expectedZoom)
      throw new AssertionError("Journal text zoom " + app.textZoom() + ", expected " + expectedZoom);
    app.clickReady("#atlas-settings");
    if (!((CheckBox)find(tr("settings.screen_on"))).isChecked() || !((CheckBox)find(tr("settings.large"))).isChecked())
      throw new AssertionError("Reading preferences were not retained");
    click(tr("settings.screen_on"));
    click(tr("settings.large"));
    app.waitForIdleSync();
    String manual = tr("atlas_settings.check_now");
    CheckBox automatic = (CheckBox)find(daily);
    if (!automatic.isChecked()) throw new AssertionError("Daily atlas updates disabled by default");
    assertAtlasSchedule(true);
    click(daily);
    assertAtlasSchedule(false);
    atlas.enable(app.getTargetContext(), app.getContext(), 1);
    click(manual);
    find(tr("atlas_settings.the_updated_atlas_is_available_offline"));
    click(manual);
    find(tr("atlas_settings.your_atlas_is_up_to_date"));
    String firstHash = new JSONObject(atlas.manifest).getString("sha256");
    atlas.enable(app.getTargetContext(), app.getContext(), 2);
    click(manual);
    find(tr("atlas_settings.the_updated_atlas_is_available_offline"));
    click(manual);
    find(tr("atlas_settings.your_atlas_is_up_to_date"));
    if (!new File(app.getTargetContext().getDir("atlas", 0), firstHash + ".json").isFile())
      throw new AssertionError("Rechecking an unchanged edition deleted the previous verified atlas");
    String goodManifest = atlas.manifest;
    atlas.damage();
    click(manual);
    find(tr("atlas_settings.the_update_failed_your_previous_atlas_is"));
    click(tr("common.back"));
    app.clickReady("#atlas-settings");
    if (((CheckBox)find(daily)).isChecked()) throw new AssertionError("Manual preference was lost");
    // Make yesterday's successful check due, then enable automatic updates without pressing Check now.
    atlas.manifest = goodManifest;
    android.content.SharedPreferences prefs = app.getTargetContext().getSharedPreferences("water-atlas", 0);
    prefs.edit().putLong("checked", 0).putLong("attempt", 0).commit();
    click(daily);
    assertAtlasSchedule(true);
    long deadline = android.os.SystemClock.elapsedRealtime() + 10000;
    while (prefs.getLong("checked", 0) == 0 && android.os.SystemClock.elapsedRealtime() < deadline)
      Thread.sleep(100);
    if (prefs.getLong("checked", 0) == 0) throw new AssertionError("Automatic atlas check did not catch up");
    click(tr("common.back"));
  }

  private void assertAtlasSchedule(boolean enabled) {
    android.app.job.JobScheduler scheduler = app.getTargetContext().getSystemService(android.app.job.JobScheduler.class);
    for (android.app.job.JobInfo job : scheduler.getAllPendingJobs()) {
      if (!job.getService().getClassName().equals("app.anglers.journal.WaterCatalogueJob")) continue;
      if (!enabled || !job.isPeriodic() || !job.isPersisted()
          || job.getIntervalMillis() != TimeUnit.DAYS.toMillis(1)
          || job.getRequiredNetwork() == null) throw new AssertionError("Invalid daily job or cancellation");
      return;
    }
    if (enabled) throw new AssertionError("Daily atlas job missing");
  }

  private void assertDisabled(String text) throws Exception {
    if (find(text).isEnabled()) throw new AssertionError("Premature profile acceptance");
  }

  void click(String text) throws Exception {
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
