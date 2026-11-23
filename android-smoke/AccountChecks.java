package app.anglers.journal.smoke;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
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
                          JSONObject body = new JSONObject(request.toString("UTF-8"));
                          switch (u.getPath()) {
                            case "/auth/v1/otp":
                              return body.getString("email").equals("test@example.invalid")
                                  ? 200
                                  : 400;
                            case "/auth/v1/verify":
                              response = "{\"access_token\":\"fixture-session\"}";
                              return body.getString("token").equals("123456") ? 200 : 403;
                            case "/rest/v1/rpc/angler_profile":
                              response = "null";
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
    type(tr("E-mail", "Email"), "test@example.invalid");
    click(tr("Poslat přihlašovací kód", "Send sign-in code"));
    type(tr("Kód z e-mailu", "Email code"), "123456");
    click(tr("Ověřit kód", "Verify code"));
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

  private void assertDisabled(String text) throws Exception {
    if (find(text).isEnabled()) throw new AssertionError("Premature profile acceptance");
  }

  private void click(String text) throws Exception {
    TextView v = find(text);
    app.runOnMainSync(v::performClick);
  }

  private void type(String hint, String value) throws Exception {
    EditText e = (EditText) find(hint);
    app.runOnMainSync(() -> e.setText(value));
  }

  private TextView find(String label) throws Exception {
    for (int i = 0; i < 80; i++) {
      TextView[] result = {null};
      app.runOnMainSync(() -> result[0] = match(gate.findViewById(android.R.id.content), label));
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
