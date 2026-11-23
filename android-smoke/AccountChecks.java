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
  private final Runner app;
  private final boolean cs;
  private Activity gate;
  private volatile boolean accepted;
  private volatile String expectedChallenge;
  private volatile boolean socialEnabled;
  private volatile int sentEmails;
  private volatile boolean wrongEmail, expireGroupSession;
  private volatile String ownGroup;
  private volatile JSONObject savedCard;
  private volatile int cardRevision;
  private volatile JSONObject submittedCatch;
  private static final String INVITE = "d18590e4-a811-4937-a16f-8eb2dacc019d";

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
                              response =
                                  new JSONObject()
                                      .put("access_token", "fixture-session")
                                      .put(
                                          "user",
                                          new JSONObject()
                                              .put(
                                                  "email",
                                                  wrongEmail
                                                      ? "other@example.invalid"
                                                      : "test@example.invalid"))
                                      .toString();
                              return 200;
                            case "/auth/v1/otp":
                              sentEmails++;
                              String redirect =
                                  Uri.parse(u.toString()).getQueryParameter("redirect_to");
                              expectedChallenge = body.getString("code_challenge");
                              return (app.getTargetContext().getPackageName()
                                              + "://account/callback")
                                          .equals(redirect)
                                      && expectedChallenge.matches("[A-Za-z0-9_-]{43}")
                                      && "s256".equals(body.getString("code_challenge_method"))
                                      && body.getString("email").equals("test@example.invalid")
                                  ? 200
                                  : 400;
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
                            case "/rest/v1/rpc/angler_groups":
                              if (expireGroupSession) return 401;
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
    gate =
        app.startActivitySync(
            new Intent(Intent.ACTION_MAIN)
                .setClassName(
                    app.getTargetContext().getPackageName(), "app.anglers.journal.AccountActivity")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
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
    requestEmail();
    socialEnabled = true;
    click(tr("Změnit e-mail", "Change email"));
    find(tr("Pokračovat přes Google", "Continue with Google"));
    app.waitForIdleSync();
    app.captureAccount(gate, "login-social");
    checkSocialLogin("Facebook");
    checkSocialLogin("Google");
    requestEmail();
    app.captureAccount(gate, "inbox");
    Uri redirect = Uri.parse(gate.getPackageName() + "://account/callback");
    deliverCallback(redirect.buildUpon().appendQueryParameter("error_code", "otp_expired").build());
    find(
        tr(
            "Odkaz už byl použitý nebo vypršel. Nech si poslat nový.",
            "This link was already used or has expired. Request a new one."));
    click(tr("Poslat nový odkaz", "Send a new link"));
    for (int i = 0; i < 80 && sentEmails < 3; i++) Thread.sleep(100);
    if (sentEmails != 3) throw new AssertionError("Resend did not request a new message");
    wrongEmail = true;
    Uri success = redirect.buildUpon().appendQueryParameter("code", "fixture-code").build();
    deliverCallback(success);
    find(
        tr(
            "Akci se nepodařilo dokončit. Zkontroluj připojení nebo údaje a opakuj pokus.",
            "Could not complete this step. Check your connection or details, then retry."));
    wrongEmail = false;
    deliverCallback(success);
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
    find(tr("Pozvánka pro jednoho rybáře", "Invite one angler"));
    dialogButton(android.R.id.button2);
    expireGroupSession = true;
    click(tr("Obnovit seznam", "Refresh groups"));
    find(tr("Přihlásit se", "Sign in"));
    // Reauthentication returns to the requested screen and the journal remains accessible.
    expireGroupSession = false;
    click(tr("Přihlásit se", "Sign in"));
    // CLEAR_TOP reuses the original profile activity.
    gate = profileGate;
    requestEmail();
    gate =
        next(
            "GroupsActivity",
            () ->
                deliverCallback(
                    Uri.parse(gate.getPackageName() + "://account/callback?code=fixture-code")));
    find("River crew" + tr(" · zakladatel", " · owner"));
    app.runOnMainSync(gate::finish);
    gate = profileGate;
    return next("FishingActivity", () -> click(tr("Otevřít deník", "Open journal")));
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

  private void requestEmail() throws Exception {
    type(tr("E-mail", "Email"), "test@example.invalid");
    click(tr("Poslat přihlašovací odkaz", "Send sign-in link"));
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
