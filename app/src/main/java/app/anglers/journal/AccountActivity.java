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
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/**
 * The launcher and OAuth callback. The journal opens only after the server confirms the profile and
 * both revisions.
 */
public final class AccountActivity extends Activity {
  private final ExecutorService io = Executors.newFixedThreadPool(2);
  private IdentityService service;
  private AccountLayout ui;
  private Button submit;
  private boolean cs, busy, groupLogin;
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
    SharedPreferences pending = AccountStore.prefs(this);
    groupLogin =
        getIntent().getBooleanExtra("groupsSignIn", false)
            || (getIntent().getData() != null
                && pendingIsFresh(pending)
                && pending.getBoolean("pkceForGroups", false));
    if (!groupLogin
        && !AccountStore.active(this).isEmpty()
        && getIntent().getData() == null
        && !getIntent().getBooleanExtra("manage", false)) {
      enter();
      return;
    }
    ui = new AccountLayout(this);
    if (!groupLogin && !AccountStore.active(this).isEmpty()) {
      manage();
      return;
    }
    email = pending.getString("pkceEmail", "");
    if (!email.isEmpty() && pendingIsFresh(pending) && service != null && service.configured()) {
      inbox();
    } else {
      login();
    }
    callback(getIntent());
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    if (intent.getBooleanExtra("groupsSignIn", false) && intent.getData() == null) {
      groupLogin = true;
      login();
    } else callback(intent);
  }

  @Override
  protected void onDestroy() {
    io.shutdownNow();
    access = null;
    super.onDestroy();
  }

  private Button action(String title, AccountLayout.Action style, Runnable handler) {
    return ui.button(
        ui.form,
        title,
        style,
        () -> {
          if (!busy) handler.run();
        });
  }

  private void documents() {
    String[] names = {
      text("Podmínky používání", "Terms of use"),
      text("Ochrana osobních údajů", "Privacy notice"),
      text("Licence a autoři", "Licenses and credits")
    };
    String[] pages = {"terms", "privacy", "license"};
    String title = text("Podmínky a soukromí", "Terms and privacy");
    action(
        title,
        AccountLayout.Action.LINK,
        () ->
            new AlertDialog.Builder(this)
                .setTitle(title)
                .setItems(names, (dialog, item) -> document(pages[item]))
                .setNegativeButton(android.R.string.cancel, null)
                .show());
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
      ui.message(text("Dokument nelze načíst.", "Could not load the document."));
    }
  }

  private void login() {
    access = null;
    profile = null;
    ui.page(text("Přihlásit se", "Sign in"), true);
    ui.label(text("Pošleme ti e-mail s přihlašovacím odkazem.", "We’ll email you a sign-in link."));
    boolean ready = service != null && service.configured();
    EditText address =
        ui.field(
            text("E-mail", "Email"),
            InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
    address.setAutofillHints(View.AUTOFILL_HINT_EMAIL_ADDRESS);
    address.setText(email);
    Button send =
        action(
            text("Poslat přihlašovací odkaz", "Send sign-in link"),
            AccountLayout.Action.PRIMARY,
            () -> {
              String value = address.getText().toString().trim();
              if (!android.util.Patterns.EMAIL_ADDRESS.matcher(value).matches()) {
                address.setError(text("Zkontroluj adresu.", "Check the address."));
                return;
              }
              sendEmail(value);
            });
    send.setEnabled(ready);
    address.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_GO);
    address.setOnEditorActionListener(
        (v, id, e) ->
            id == android.view.inputmethod.EditorInfo.IME_ACTION_GO && send.performClick());
    LinearLayout social = new LinearLayout(this);
    social.setOrientation(LinearLayout.VERTICAL);
    ui.form.addView(social);
    if (ready) loadProviders(social, send);
    else
      ui.message(text("Přihlášení zatím není k dispozici.", "Sign-in is currently unavailable."));
    documents();
  }

  /**
   * Discover enabled providers once for this page without blocking email or a returning callback.
   */
  private void loadProviders(LinearLayout social, Button emailButton) {
    io.execute(
        () -> {
          try {
            JSONObject enabled = service.providers();
            runOnUiThread(
                () -> {
                  if (isDestroyed() || isFinishing() || social.getParent() != ui.form) return;
                  if (enabled.has("email")) emailButton.setEnabled(enabled.optBoolean("email"));
                  for (String provider : new String[] {"google", "facebook"}) {
                    if (!enabled.optBoolean(provider)) continue;
                    String name = provider.equals("google") ? "Google" : "Facebook";
                    Button button =
                        ui.button(
                            social,
                            text("Pokračovat přes ", "Continue with ") + name,
                            AccountLayout.Action.SECONDARY,
                            () -> {
                              if (!busy) oauth(provider);
                            });
                    if (provider.equals("google")) {
                      android.graphics.drawable.Drawable logo =
                          getDrawable(R.drawable.google_sign_in);
                      int size = Math.round(20 * getResources().getDisplayMetrics().density);
                      logo.setBounds(0, 0, size, size);
                      button.setCompoundDrawablesRelative(logo, null, null, null);
                    }
                  }
                });
          } catch (Exception ignored) {
            /* Email can still be requested if provider discovery fails. */
          }
        });
  }

  /** Reuse the pending verifier on resend so a rate limit cannot invalidate the previous link. */
  private void sendEmail(String address) {
    if (busy || service == null || !service.configured()) return;
    SharedPreferences pending = AccountStore.prefs(this);
    boolean same =
        address.equalsIgnoreCase(pending.getString("pkceEmail", "")) && pendingIsFresh(pending);
    String verifier = same ? pending.getString("pkce", "") : IdentityService.verifier();
    run(
        () -> {
          service.sendSignInEmail(address, verifier);
          return address;
        },
        sent -> {
          if (!savePending(verifier, sent)) return;
          email = sent;
          inbox();
          callback(getIntent());
        });
  }

  private void inbox() {
    ui.page(text("Zkontroluj e-mail", "Check your email"), false);
    ui.label(
        text("Otevři nejnovější zprávu na adrese ", "Open the latest message sent to ")
            + email
            + text(
                " a klepni na odkaz na tomto telefonu. Vrátíš se do deníku.",
                " and tap the link on this phone to return to your journal."));
    action(
        text("Otevřít poštu", "Open inbox"),
        AccountLayout.Action.PRIMARY,
        () -> {
          try {
            startActivity(
                Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_EMAIL));
          } catch (ActivityNotFoundException missing) {
            ui.message(
                text(
                    "Otevři svou schránku v prohlížeči na tomto telefonu.",
                    "Open your webmail in the browser on this phone."));
          }
        });
    action(
        text("Poslat nový odkaz", "Send a new link"),
        AccountLayout.Action.SECONDARY,
        () -> sendEmail(email));
    action(
        text("Změnit e-mail", "Change email"),
        AccountLayout.Action.LINK,
        () -> {
          clearPending();
          login();
        });
  }

  private boolean savePending(String verifier, String address) {
    boolean saved =
        AccountStore.prefs(this)
            .edit()
            .putBoolean("pkceForGroups", groupLogin)
            .putString("pkce", verifier)
            .putString("pkceEmail", address)
            .putLong("pkceAt", System.currentTimeMillis())
            .commit();
    if (!saved)
      ui.message(
          text(
              "Přihlášení nelze uložit. Zkus to znovu.",
              "Could not save the sign-in request. Please retry."));
    return saved;
  }

  private void clearPending() {
    AccountStore.prefs(this)
        .edit()
        .remove("pkceForGroups")
        .remove("pkce")
        .remove("pkceAt")
        .remove("pkceEmail")
        .apply();
  }

  private boolean pendingIsFresh(SharedPreferences pending) {
    long age = System.currentTimeMillis() - pending.getLong("pkceAt", 0);
    long limit =
        pending.getString("pkceEmail", "").isEmpty()
            ? TimeUnit.MINUTES.toMillis(10)
            : TimeUnit.DAYS.toMillis(1);
    return pending.contains("pkce") && age >= 0 && age <= limit;
  }

  private String expiredEmailMessage() {
    return text(
        "Odkaz už byl použitý nebo vypršel. Nech si poslat nový.",
        "This link was already used or has expired. Request a new one.");
  }

  private void oauth(String provider) {
    try {
      String verifier = IdentityService.verifier();
      Uri url = service.authorize(provider, verifier);
      if (!savePending(verifier, "")) return;
      startActivity(new Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE));
    } catch (Exception e) {
      ui.message(text("Prohlížeč nelze otevřít.", "Could not open a browser."));
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
    String expectedEmail = p.getString("pkceEmail", "");
    String errorCode = uri.getQueryParameter("error_code");
    if (errorCode == null && uri.getEncodedFragment() != null) {
      errorCode =
          Uri.parse("https://callback.invalid/?" + uri.getEncodedFragment())
              .getQueryParameter("error_code");
    }
    if ("otp_expired".equals(errorCode)) {
      ui.message(expiredEmailMessage());
      return;
    }
    String code = uri.getQueryParameter("code");
    if (!service.configured()
        || !pendingIsFresh(p)
        || verifier.isEmpty()
        || code == null
        || code.isEmpty()) {
      ui.message(
          text(
              "Přihlášení nebylo dokončeno. Zkus to znovu.",
              "Sign-in was not completed. Please retry."));
      return;
    }
    run(() -> service.exchange(code, verifier, expectedEmail), this::verified);
  }

  private void verified(String token) {
    clearPending();
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
    ui.page(text("Rybářský profil", "Angler profile"), false);
    EditText nickname =
        ui.field(
            text("Přezdívka (2–60 znaků)", "Display name (2–60 characters)"),
            InputType.TYPE_CLASS_TEXT);
    if (profile.has("name")) {
      nickname.setText(profile.optString("name"));
      nickname.setEnabled(false);
    }
    CheckBox terms = ui.check(text("Přijímám podmínky používání.", "I accept the terms of use."));
    CheckBox privacy =
        ui.check(
            text(
                "Seznámil/a jsem se s informacemi o zpracování údajů.",
                "I acknowledge the privacy notice."));
    submit =
        action(
            text("Uložit profil", "Save profile"),
            AccountLayout.Action.PRIMARY,
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
    documents();
    action(text("Zpět k přihlášení", "Back to sign-in"), AccountLayout.Action.LINK, this::login);
  }

  private void finishProfile(JSONObject result) {
    if (!result.optBoolean("current") || !result.has("id") || !result.has("name")) {
      login();
      return;
    }
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

    AccountStore.activate(this, result.optString("id"), result.optString("name"), legacy, access);
    access = null;
    if (groupLogin) {
      groupLogin = false;
      getIntent().removeExtra("groupsSignIn");
      getIntent().putExtra("manage", true);
      manage();
      startActivity(new Intent(this, GroupsActivity.class));
    } else enter();
  }

  private void enter() {
    startActivity(new Intent(this, FishingActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP));
    finish();
  }

  private void manage() {
    ui.page(AccountStore.prefs(this).getString("name", ""), false);
    ui.label(
        text(
            "O opravu, kopii nebo výmaz účtu požádej na milan.kucera78@gmail.com.",
            "For account correction, access or deletion contact milan.kucera78@gmail.com."));
    action(
        text("Rybářské party", "Fishing groups"),
        AccountLayout.Action.PRIMARY,
        () -> startActivity(new Intent(this, GroupsActivity.class)));
    action(
        text("Odhlásit se z telefonu", "Sign out on this phone"),
        AccountLayout.Action.SECONDARY,
        () -> {
          clearPending();
          AccountStore.logout(this);
          login();
        });
    action(text("Otevřít deník", "Open journal"), AccountLayout.Action.PRIMARY, this::enter);
    documents();
  }

  private interface Work<T> {
    T call() throws Exception;
  }

  private <T> void run(Work<T> work, java.util.function.Consumer<T> done) {
    if (busy) return;
    busy = true;
    ui.message(text("Probíhá ověření…", "Contacting account service…"));
    io.execute(
        () -> {
          try {
            T value = work.call();
            runOnUiThread(
                () -> {
                  if (isFinishing() || isDestroyed()) return;
                  busy = false;
                  ui.message("");
                  done.accept(value);
                });
          } catch (Exception error) {
            runOnUiThread(
                () -> {
                  if (isFinishing() || isDestroyed()) return;
                  busy = false;
                  ui.message(
                      error instanceof IdentityService.EmailRateLimit
                          ? text(
                              "Další odkaz zatím nelze odeslat. Zkus to později.",
                              "Please wait before requesting another link.")
                          : text(
                              "Akci se nepodařilo dokončit. Zkontroluj připojení nebo údaje a"
                                  + " opakuj pokus.",
                              "Could not complete this step. Check your connection or details, then"
                                  + " retry."));
                });
          }
        });
  }
}
