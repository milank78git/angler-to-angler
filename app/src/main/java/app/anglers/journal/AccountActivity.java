package app.anglers.journal;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * The launcher and OAuth callback. The journal opens only after the server confirms the profile and
 * both revisions.
 */
public final class AccountActivity extends Activity {
  private final ExecutorService io = Executors.newSingleThreadExecutor();
  private IdentityService service;
  private LinearLayout body;
  private TextView status;
  private Button submit;
  private boolean cs, busy;
  private String access, email = "";
  private JSONObject profile;

  private String text(String cz, String en) {
    return cs ? cz : en;
  }

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    cs = "cs".equals(getResources().getConfiguration().getLocales().get(0).getLanguage());
    try {
      service = new IdentityService(this, cs);
    } catch (Exception ignored) {
      /* Show the unavailable state. */
    }
    if (!AccountStore.active(this).isEmpty()
        && getIntent().getData() == null
        && !getIntent().getBooleanExtra("manage", false)) {
      enter();
      return;
    }
    if (!AccountStore.active(this).isEmpty()) {
      manage();
      return;
    }
    login();
    callback(getIntent());
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    callback(intent);
  }

  @Override
  protected void onDestroy() {
    io.shutdownNow();
    access = null;
    super.onDestroy();
  }

  private void page(String title) {
    ScrollView scroll = new ScrollView(this);
    scroll.setFitsSystemWindows(true);
    body = new LinearLayout(this);
    body.setOrientation(LinearLayout.VERTICAL);
    int pad = (int) (24 * getResources().getDisplayMetrics().density);
    body.setPadding(pad, pad, pad, pad);
    scroll.addView(body);
    setContentView(scroll);
    TextView heading = label(title);
    heading.setTextSize(28);
    if (android.os.Build.VERSION.SDK_INT >= 28) heading.setAccessibilityHeading(true);
    status = label("");
    status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
  }

  private TextView label(String value) {
    TextView v = new TextView(this);
    v.setText(value);
    v.setTextSize(16);
    body.addView(v);
    return v;
  }

  private Button action(String title, Runnable handler) {
    Button b = new Button(this);
    b.setAllCaps(false);
    b.setText(title);
    body.addView(b);
    b.setOnClickListener(
        v -> {
          if (!busy) handler.run();
        });
    return b;
  }

  private EditText input(String hint, int type) {
    EditText field = new EditText(this);
    field.setSingleLine();
    field.setInputType(type);
    field.setHint(hint);
    body.addView(field);
    return field;
  }

  private CheckBox check(String title) {
    CheckBox box = new CheckBox(this);
    box.setText(title);
    body.addView(box);
    return box;
  }

  private void documents() {
    action(text("Podmínky používání", "Terms of use"), () -> document("terms"));
    action(text("Ochrana osobních údajů", "Privacy notice"), () -> document("privacy"));
    action(text("Licence a autoři", "Licenses and credits"), () -> document("license"));
  }

  private void document(String kind) {
    try {
      String contents;
      if (kind.equals("license")) {
        contents =
            IdentityService.asset(this, "notice.txt")
                + "\n\n"
                + IdentityService.asset(this, "license.txt")
                + "\n\n"
                + IdentityService.asset(this, "icon-license.txt");
      } else {
        contents = IdentityService.asset(this, kind + "-" + (cs ? "cs" : "en") + ".txt");
      }
      if (kind.equals("privacy") && service != null && !service.notice.isEmpty())
        contents += "\n\n" + service.notice;
      new AlertDialog.Builder(this)
          .setMessage(contents)
          .setPositiveButton(android.R.string.ok, null)
          .show();
    } catch (Exception e) {
      status.setText(text("Dokument nelze načíst.", "Could not load the document."));
    }
  }

  private void login() {
    access = null;
    profile = null;
    page(text("Přihlášení k deníku", "Sign in to your journal"));
    documents();
    boolean ready = service != null && service.configured();
    if (!ready)
      status.setText(
          text(
              "Přihlášení v tomto sestavení čeká na konfiguraci provozovatele.",
              "The operator has not configured sign-in for this build."));
    for (String provider : new String[] {"google", "facebook"}) {
      String name = provider.equals("google") ? "Google" : "Facebook";
      action(text("Pokračovat přes ", "Continue with ") + name, () -> oauth(provider))
          .setEnabled(ready);
    }
    EditText address =
        input(
            text("E-mail", "Email"),
            InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
    address.setText(email);
    action(
            text("Poslat přihlašovací e-mail", "Send sign-in email"),
            () -> {
              String value = address.getText().toString().trim();
              if (!android.util.Patterns.EMAIL_ADDRESS.matcher(value).matches()) {
                address.setError(text("Zkontroluj adresu.", "Check the address."));
                return;
              }
              run(
                  () -> {
                    service.sendSignInEmail(value);
                    return value;
                  },
                  sent -> {
                    email = sent;
                    code();
                  });
            })
        .setEnabled(ready);
  }

  private void code() {
    page(text("Ověření e-mailu", "Verify email"));
    label(email);
    label(
        text(
            "V doručeném e-mailu podrž přihlašovací odkaz, zkopíruj ho a vlož sem. Pokud zpráva"
                + " obsahuje číselný kód, stačí ho opsat.",
            "In the email, press and hold the sign-in link, copy it and paste it here. If the"
                + " message contains a numeric code, enter that instead."));
    EditText proof =
        input(
            text("Odkaz nebo kód z e-mailu", "Email link or code"),
            InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
    proof.setSaveEnabled(false);
    proof.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
    action(
        text("Ověřit e-mail", "Verify email address"),
        () -> {
          String value = proof.getText().toString().trim();
          if (value.isEmpty()) return;
          run(() -> service.verifyEmail(email, value), this::verified);
        });
    action(
        text("Změnit adresu nebo poslat nový e-mail", "Change address or request another email"),
        this::login);
  }

  private void oauth(String provider) {
    try {
      String verifier = IdentityService.verifier();
      Uri url = service.authorize(provider, verifier);
      AccountStore.prefs(this)
          .edit()
          .putString("pkce", verifier)
          .putLong("pkceAt", System.currentTimeMillis())
          .commit();
      startActivity(new Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE));
    } catch (Exception e) {
      status.setText(text("Prohlížeč nelze otevřít.", "Could not open a browser."));
    }
  }

  private void callback(Intent intent) {
    Uri uri = intent.getData();
    if (uri == null || service == null || busy) return;
    if (!Intent.ACTION_VIEW.equals(intent.getAction())
        || !uri.toString().split("[?#]", 2)[0].equals(service.redirect)) return;
    intent.setData(null);
    SharedPreferences p = AccountStore.prefs(this);
    String verifier = p.getString("pkce", "");
    long age = System.currentTimeMillis() - p.getLong("pkceAt", 0);
    p.edit().remove("pkce").remove("pkceAt").commit();
    String code = uri.getQueryParameter("code");
    if (!service.configured()
        || age < 0
        || age > 600000
        || verifier.isEmpty()
        || code == null
        || code.isEmpty()) {
      status.setText(
          text(
              "Přihlášení nebylo dokončeno. Zkus to znovu.",
              "Sign-in was not completed. Please retry."));
      return;
    }
    run(() -> service.exchange(code, verifier), this::verified);
  }

  private void verified(String token) {
    access = token;
    run(
        () -> service.profile(token),
        result -> {
          profile = result;
          if (result.optBoolean("current")) finishProfile(result);
          else registration();
        });
  }

  private void registration() {
    page(text("Rybářský profil", "Angler profile"));
    documents();
    EditText nickname =
        input(
            text("Přezdívka (2–60 znaků)", "Display name (2–60 characters)"),
            InputType.TYPE_CLASS_TEXT);
    if (profile.has("name")) {
      nickname.setText(profile.optString("name"));
      nickname.setEnabled(false);
    }
    CheckBox terms = check(text("Přijímám podmínky používání.", "I accept the terms of use."));
    CheckBox privacy =
        check(
            text(
                "Seznámil/a jsem se s informacemi o zpracování údajů.",
                "I acknowledge the privacy notice."));
    submit =
        action(
            text("Uložit profil", "Save profile"),
            () -> {
              String name = nickname.getText().toString().trim();
              if (name.codePointCount(0, name.length()) < 2
                  || name.codePointCount(0, name.length()) > 60) {
                nickname.setError(text("Zadej 2 až 60 znaků.", "Enter 2 to 60 characters."));
                return;
              }
              if (!terms.isChecked() || !privacy.isChecked()) return;
              run(() -> service.accept(access, name), this::finishProfile);
            });
    submit.setEnabled(false);
    CompoundButton.OnCheckedChangeListener update =
        (box, value) -> submit.setEnabled(terms.isChecked() && privacy.isChecked());
    terms.setOnCheckedChangeListener(update);
    privacy.setOnCheckedChangeListener(update);
    action(text("Zpět k přihlášení", "Back to sign-in"), this::login);
  }

  private void finishProfile(JSONObject result) {
    if (!result.optBoolean("current") || !result.has("id") || !result.has("name")) {
      login();
      return;
    }
    access = null;
    Runnable fresh = () -> activate(result, false);
    if (AccountStore.prefs(this).contains("legacyOwner")
        || !new java.io.File(getApplicationInfo().dataDir, "app_webview").isDirectory()) {
      fresh.run();
      return;
    }
    new AlertDialog.Builder(this)
        .setTitle(text("Deník ze starší verze", "Journal from an older version"))
        .setMessage(
            text(
                "Patří dřívější místní deník na tomto telefonu tobě? Můžeš ho propojit se svým"
                    + " prvním ověřeným profilem.",
                "Does the earlier journal on this device belong to you? You can link it to this"
                    + " first verified profile."))
        .setCancelable(false)
        .setNegativeButton(text("Nový deník", "Fresh journal"), (d, w) -> fresh.run())
        .setPositiveButton(
            text("Připojit můj deník", "Link my journal"), (d, w) -> activate(result, true))
        .show();
  }

  private void activate(JSONObject result, boolean legacy) {

    AccountStore.activate(this, result.optString("id"), result.optString("name"), legacy);
    enter();
  }

  private void enter() {
    startActivity(new Intent(this, FishingActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP));
    finish();
  }

  private void manage() {
    page(AccountStore.prefs(this).getString("name", ""));
    documents();
    label(
        text(
            "O opravu, kopii nebo výmaz účtu požádej na milan.kucera78@gmail.com.",
            "For account correction, access or deletion contact milan.kucera78@gmail.com."));
    action(
        text("Odhlásit se z telefonu", "Sign out on this phone"),
        () -> {
          AccountStore.logout(this);
          login();
        });
    action(text("Otevřít deník", "Open journal"), this::enter);
  }

  private interface Work<T> {
    T call() throws Exception;
  }

  private <T> void run(Work<T> work, java.util.function.Consumer<T> done) {
    if (busy) return;
    busy = true;
    status.setText(text("Probíhá ověření…", "Contacting account service…"));
    io.execute(
        () -> {
          try {
            T value = work.call();
            runOnUiThread(
                () -> {
                  if (isFinishing() || isDestroyed()) return;
                  busy = false;
                  status.setText("");
                  done.accept(value);
                });
          } catch (Exception error) {
            runOnUiThread(
                () -> {
                  if (isFinishing() || isDestroyed()) return;
                  busy = false;
                  status.setText(
                      text(
                          "Akci se nepodařilo dokončit. Zkontroluj připojení nebo údaje a opakuj"
                              + " pokus.",
                          "Could not complete this step. Check your connection or details, then"
                              + " retry."));
                });
          }
        });
  }
}
