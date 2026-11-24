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
 * The launcher and account UI. The journal opens only after the server confirms the profile and
 * both revisions.
 */
public final class AccountActivity extends Activity {
  private final ExecutorService io = Executors.newFixedThreadPool(2);
  private IdentityService service;
  private AccountLayout ui;
  private Button submit;
  private boolean cs, busy, groupLogin, profileLogin;
  private String email = "";
  private IdentityService.Session signing;
  private android.os.CancellationSignal prompt;
  private boolean managing;
  private JSONObject profile;

  private String text(String cz, String en) {
    return AppLanguage.text(this, cz, en);
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
    groupLogin = getIntent().getBooleanExtra("groupsSignIn", false);
    profileLogin = getIntent().getBooleanExtra("profileSignIn", false);
    if (!groupLogin && !profileLogin && pendingIsFresh(pending)) {
      groupLogin = pending.getBoolean("pkceForGroups", false);
      profileLogin = pending.getBoolean("pkceForProfile", false);
    }
    ui = new AccountLayout(this);
    email = pending.getString("pkceEmail", pending.getString("email", ""));
    if (getIntent().getData() != null) {
      if (pendingIsFresh(pending) && !email.isEmpty()) inbox();
      else login();
      callback(getIntent());
    } else if (!groupLogin && !profileLogin && !AccountStore.active(this).isEmpty()) {
      if (getIntent().getBooleanExtra("manage", false)) manage();
      else enter();
    } else if (pendingIsFresh(pending)
        && pending.getBoolean("pkceMailAccepted", true)
        && !pending.getString("pkceEmail", "").isEmpty()) inbox();
    else {
      login();
      if (DeviceVault.enrolled(this) && !groupLogin && !profileLogin) unlock();
    }
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (managing && AccountStore.active(this).isEmpty()) login();
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    // A launcher tap only brings the current screen forward, including a pending mail callback.
    if (Intent.ACTION_MAIN.equals(intent.getAction()) && intent.getData() == null) return;
    setIntent(intent);
    if ((intent.getBooleanExtra("groupsSignIn", false)
            || intent.getBooleanExtra("profileSignIn", false))
        && intent.getData() == null) {
      groupLogin = intent.getBooleanExtra("groupsSignIn", false);
      profileLogin = intent.getBooleanExtra("profileSignIn", false);
      login();
    } else callback(intent);
  }

  @Override
  protected void onDestroy() {
    io.shutdownNow();
    if (prompt != null) prompt.cancel();
    signing = null;
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
        () -> {
          AccountLayout.Prompt menu = ui.prompt(title);
          for (int i = 0; i < pages.length; i++) {
            String kind = pages[i], name = names[i];
            menu.choice(name, AccountLayout.Action.SECONDARY, () -> document(kind, name));
          }
          menu.action(text("Zavřít", "Close"), AccountLayout.Action.SECONDARY, null);
          menu.show();
        });
  }

  private void document(String kind, String title) {
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
      if (kind.equals("privacy"))
        contents +=
            "\n\n" + IdentityService.asset(this, "optional-profile-" + (cs ? "cs" : "en") + ".txt");
      if (kind.equals("privacy") && service != null && !service.notice.isEmpty())
        contents += "\n\n" + service.notice;
      AccountLayout.Prompt reader = ui.prompt(title);
      reader.description(contents);
      reader.action(text("Zavřít", "Close"), AccountLayout.Action.PRIMARY, null);
      reader.show();
    } catch (Exception e) {
      ui.message(text("Dokument nelze načíst.", "Could not load the document."));
    }
  }

  private void login() {
    signing = null;
    managing = false;
    profile = null;
    ui.page(text("Přihlášení", "Account sign-in"), true);
    boolean ready = service != null && service.configured();
    if (DeviceVault.enrolled(this))
      action(
          text("Odemknout telefonem", "Unlock with device"),
          AccountLayout.Action.PRIMARY,
          this::unlock);
    EditText address = addressField(text("Použij e-mail svého účtu.", "Enter the email address for your account."));
    EditText password = passwordField(false);
    Button send =
        action(
            text("Přihlásit se", "Sign in"),
            AccountLayout.Action.PRIMARY,
            () -> {
              if (!readAddress(address) || !validPassword(password, false)) return;
              String secret = password.getText().toString();
              run(() -> service.signIn(email, secret), this::verified);
            });
    send.setEnabled(ready);
    password.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_GO);
    password.setOnEditorActionListener(
        (v, id, e) ->
            id == android.view.inputmethod.EditorInfo.IME_ACTION_GO && send.performClick());
    action(
            text("Vytvořit účet", "Create account"),
            AccountLayout.Action.SECONDARY,
            () -> {
              email = address.getText().toString().trim();
              emailForm(false);
            })
        .setEnabled(ready);
    action(
            text("Nastavit nebo obnovit heslo", "Set or reset password"),
            AccountLayout.Action.LINK,
            () -> {
              email = address.getText().toString().trim();
              emailForm(true);
            })
        .setEnabled(ready);
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

  private EditText addressField(String explanation) {
    EditText field =
        ui.field(
            text("E-mail", "Email"),
            InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
    ui.explain(field.getHint().toString(), explanation, field);
    field.setAutofillHints(View.AUTOFILL_HINT_USERNAME, View.AUTOFILL_HINT_EMAIL_ADDRESS);
    field.setText(email);
    return field;
  }

  private boolean readAddress(EditText field) {
    String value = field.getText().toString().trim();
    if (!android.util.Patterns.EMAIL_ADDRESS.matcher(value).matches()) {
      field.setError(text("Zkontroluj adresu.", "Check the address."));
      return false;
    }
    email = value;
    return true;
  }

  private EditText passwordField(boolean fresh) {
    EditText field =
        ui.field(
            fresh ? text("Nové heslo", "New password") : text("Heslo", "Password"),
            InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
    ui.explain(field.getHint().toString(), fresh
        ? text("Zvol heslo s alespoň 8 znaky. Použiješ ho při dalším přihlášení.", "Choose a password of at least 8 characters for future sign-ins.")
        : text("Zadej heslo nastavené při registraci. Zapomenuté heslo obnovíš odkazem z přihlašovací obrazovky.",
            "Enter the password set at registration. Use password recovery on the sign-in screen if you have forgotten it."), field);
    field.setSaveEnabled(false);
    field.setAutofillHints(fresh ? "newPassword" : View.AUTOFILL_HINT_PASSWORD);
    return field;
  }

  private boolean validPassword(EditText field, boolean fresh) {
    String value = field.getText().toString();
    if (!value.isEmpty() && (!fresh || value.codePointCount(0, value.length()) >= 8)) return true;
    field.setError(
        fresh
            ? text("Zadej alespoň 8 znaků.", "Use at least 8 characters.")
            : text("Zadej heslo.", "Enter your password."));
    return false;
  }

  private void emailForm(boolean recovery) {
    ui.page(
        recovery ? text("Nastavení hesla", "Password setup") : text("Registrace", "Registration"),
        false);
    ui.label(
        recovery
            ? text(
                "Pokud už máš účet, pošleme ti odkaz pro nastavení hesla. Použij stejný e-mail jako"
                    + " při registraci.",
                "If you already have an account, we’ll send a link to set your password. Use the"
                    + " email you registered with.")
            : text(
                "Zvol si heslo s alespoň 8 znaky. E-mail ověříš jednou na tomto telefonu.",
                "Choose a password with at least 8 characters. Confirm your email once on this"
                    + " phone."));
    EditText address = addressField(recovery
        ? text("Na ověřenou adresu účtu přijde odkaz pro nastavení nového hesla.",
            "The password reset link will go to the verified email address for your account.")
        : text("Zadej adresu, na kterou ti můžeme poslat potvrzení registrace.",
            "Enter an email address where you can receive the registration confirmation."));
    EditText password = recovery ? null : passwordField(true);
    action(
        recovery
            ? text("Poslat odkaz pro nastavení hesla", "Send password setup link")
            : text("Zaregistrovat se", "Register"),
        AccountLayout.Action.PRIMARY,
        () -> {
          if (!readAddress(address) || (!recovery && !validPassword(password, true))) return;
          String purpose = recovery ? "recovery" : "signup";
          SharedPreferences p = AccountStore.prefs(this);
          String verifier =
              pendingIsFresh(p)
                      && purpose.equals(p.getString("pkcePurpose", ""))
                      && email.equalsIgnoreCase(p.getString("pkceEmail", ""))
                  ? p.getString("pkce", "")
                  : IdentityService.verifier();
          if (!savePending(verifier, email, purpose)) return;
          String secret = recovery ? "" : password.getText().toString();
          run(
              () -> {
                if (recovery) {
                  service.recover(email, verifier);
                  return null;
                }
                return service.signUp(email, secret, verifier);
              },
              (IdentityService.Session session) -> {
                p.edit().putBoolean("pkceMailAccepted", true).apply();
                if (session != null) verified(session);
                else {
                  inbox();
                  callback(getIntent());
                }
              });
        });
    action(text("Zpět k přihlášení", "Back to sign-in"), AccountLayout.Action.LINK, this::login);
  }

  private void choosePassword(IdentityService.Session recovery) {
    clearPending();
    ui.page(text("Nastav nové heslo", "Set a new password"), false);
    EditText field = passwordField(true);
    action(
        text("Uložit heslo", "Save password"),
        AccountLayout.Action.PRIMARY,
        () -> {
          if (!validPassword(field, true)) return;
          String secret = field.getText().toString();
          run(
              () -> {
                service.setPassword(recovery, secret);
                return recovery;
              },
              this::verified);
        });
    action(text("Zpět k přihlášení", "Back to sign-in"), AccountLayout.Action.LINK, this::login);
  }

  /** Use the OS authentication UI and a Keystore-protected key on the same device. */
  private void unlock() {
    if (busy || prompt != null || !DeviceVault.enrolled(this)) return;
    String title = text("Odemknout deník", "Unlock journal");
    if (android.os.Build.VERSION.SDK_INT >= 29) {
      android.hardware.biometrics.BiometricPrompt.Builder builder =
          new android.hardware.biometrics.BiometricPrompt.Builder(this).setTitle(title);
      if (android.os.Build.VERSION.SDK_INT >= 30)
        builder.setAllowedAuthenticators(
            android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_STRONG
                | android.hardware.biometrics.BiometricManager.Authenticators.DEVICE_CREDENTIAL);
      else builder.setDeviceCredentialAllowed(true);
      prompt = new android.os.CancellationSignal();
      builder
          .build()
          .authenticate(
              prompt,
              getMainExecutor(),
              new android.hardware.biometrics.BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(
                    android.hardware.biometrics.BiometricPrompt.AuthenticationResult result) {
                  prompt = null;
                  if (!isFinishing() && !isDestroyed()) openVault();
                }

                @Override
                public void onAuthenticationError(int code, CharSequence message) {
                  prompt = null;
                }
              });
    } else {
      Intent confirm =
          getSystemService(KeyguardManager.class).createConfirmDeviceCredentialIntent(title, null);
      if (confirm != null) startActivityForResult(confirm, 31);
    }
  }

  @Override
  protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    if (request == 31 && result == RESULT_OK) openVault();
  }

  private void openVault() {
    run(
        () -> AccountStore.unlock(this),
        local -> {
          if (!groupLogin && !profileLogin && !AccountStore.active(this).isEmpty()) {
            if (getIntent().getBooleanExtra("manage", false)) manage();
            else enter();
          } else run(() -> AccountStore.online(this, service, local.id, null), this::verified);
        });
  }

  private void inbox() {
    ui.page(text("Zkontroluj e-mail", "Check your email"), false);
    ui.label(
        text("Otevři nejnovější zprávu na adrese ", "Open the latest message sent to ")
            + email
            + text(
                " a klepni na odkaz na tomto telefonu. Do aplikace se můžeš také vrátit přes její"
                    + " ikonu.",
                " and tap the link on this phone. You can also return by tapping the app icon."));
    action(
        text("Otevřít poštu", "Open inbox"),
        AccountLayout.Action.PRIMARY,
        () -> {
          try {
            startActivity(
                Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_EMAIL)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
          } catch (ActivityNotFoundException missing) {
            ui.message(
                text(
                    "Otevři svou schránku v prohlížeči na tomto telefonu.",
                    "Open your webmail in the browser on this phone."));
          }
        });
    String purpose = AccountStore.prefs(this).getString("pkcePurpose", "");
    if ("recovery".equals(purpose) || "signup".equals(purpose))
      action(
          text("Vyžádat nový odkaz", "Request another link"),
          AccountLayout.Action.SECONDARY,
          () -> resendEmail(purpose));
    action(
        text("Zpět k přihlášení", "Back to sign-in"),
        AccountLayout.Action.LINK,
        () -> {
          clearPending();
          login();
        });
  }

  /** Reissue the pending link with the same address, callback and device verifier. */
  private void resendEmail(String purpose) {
    SharedPreferences pending = AccountStore.prefs(this);
    String verifier = pending.getString("pkce", "");
    String address = pending.getString("pkceEmail", "");
    if (verifier.isEmpty() || address.isEmpty()) {
      login();
      return;
    }
    run(
        () -> {
          if ("signup".equals(purpose)) service.resendSignup(address, verifier);
          else service.recover(address, verifier);
          return null;
        },
        ignored -> {
          pending.edit().putLong("pkceAt", System.currentTimeMillis()).apply();
          ui.message(
              text(
                  "O nový odkaz bylo požádáno. Zkontroluj poštu.",
                  "New link requested. Check your inbox."));
          callback(getIntent());
        });
  }

  private boolean savePending(String verifier, String address, String purpose) {
    SharedPreferences pending = AccountStore.prefs(this);
    boolean previouslyAccepted =
        verifier.equals(pending.getString("pkce", ""))
            && pending.getBoolean("pkceMailAccepted", true);
    boolean saved =
        pending
            .edit()
            .putBoolean("pkceForGroups", groupLogin)
            .putBoolean("pkceForProfile", profileLogin)
            .putString("pkce", verifier)
            .putString("pkcePurpose", purpose)
            .putBoolean("pkceMailAccepted", previouslyAccepted)
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
        .remove("pkceForProfile")
        .remove("pkce")
        .remove("pkcePurpose")
        .remove("pkceMailAccepted")
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
      if (!savePending(verifier, "", "oauth")) return;
      startActivity(new Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE));
    } catch (Exception e) {
      ui.message(text("Prohlížeč nelze otevřít.", "Could not open a browser."));
    }
  }

  private void callback(Intent intent) {
    Uri uri = intent.getData();
    if (uri == null || service == null || busy) return;
    if (!AccountCallbackActivity.matches(this, intent)) return;
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
    boolean recovery = "recovery".equals(p.getString("pkcePurpose", ""));
    run(
        () -> service.exchange(code, verifier, expectedEmail),
        session -> {
          if (recovery) choosePassword(session);
          else verified(session);
        });
  }

  private void verified(IdentityService.Session auth) {
    clearPending();
    signing = auth;
    run(
        () -> service.profile(auth.access),
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
    ui.explain(nickname.getHint().toString(), text("Tuto přezdívku uvidí ostatní u tvých příspěvků.",
        "Other anglers will see this display name on your posts."), nickname);
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
              run(() -> service.accept(signing.access, name), this::finishProfile);
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
    if (!result.optBoolean("current")
        || signing == null
        || !signing.id.equals(result.optString("id"))
        || !result.has("name")) {
      login();
      return;
    }
    Runnable fresh = () -> activate(result, false);
    if (AccountStore.prefs(this).contains("legacyOwner")) {
      fresh.run();
      return;
    }
    AccountLayout.Prompt journal =
        ui.prompt(text("Deník ze starší verze", "Journal from an older version"));
    journal.description(
        text(
            "Patří dřívější místní deník na tomto telefonu tobě? Můžeš ho propojit se svým"
                + " prvním ověřeným profilem.",
            "Does the earlier journal on this device belong to you? You can link it to this"
                + " first verified profile."));
    journal.setCancelable(false);
    journal.action(
        text("Připojit můj deník", "Link my journal"),
        AccountLayout.Action.PRIMARY,
        () -> activate(result, true));
    journal.action(text("Nový deník", "Fresh journal"), AccountLayout.Action.SECONDARY, fresh);
    journal.show();
  }

  private void activate(JSONObject result, boolean legacy) {

    IdentityService.Session auth = signing;
    run(
        () -> {
          AccountStore.activate(this, result.getString("name"), legacy, auth);
          return auth.id;
        },
        id -> {
          signing = null;
          if (!id.equals(AccountStore.active(this))) {
            login();
            return;
          }
          if (groupLogin) {
            groupLogin = false;
            getIntent().removeExtra("groupsSignIn");
            getIntent().putExtra("manage", true);
            manage();
            startActivity(new Intent(this, GroupsActivity.class));
          } else enter();
        });
  }

  private void enter() {
    startActivity(
        new Intent(this, FishingActivity.class)
            .putExtra("openProfile", profileLogin)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP));
    finish();
  }

  private void manage() {
    managing = true;
    ui.page(AccountStore.prefs(this).getString("name", ""), false);
    ui.label(
        text(
            "O opravu, kopii nebo výmaz účtu požádej na milan.kucera78@gmail.com.",
            "For account correction, access or deletion contact milan.kucera78@gmail.com."));
    action(text("Aktualizace atlasu revírů", "Water atlas updates"), AccountLayout.Action.SECONDARY,
        () -> startActivity(new Intent(this, WaterSettingsActivity.class)));
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
          email = "";
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
                  ui.message(errorMessage(error));
                  // A link can arrive while a mail request is still waiting for its response.
                  callback(getIntent());
                });
          }
        });
  }

  private String errorMessage(Exception error) {
    if (error instanceof IdentityService.EmailRateLimit)
      return text(
          "Příliš mnoho pokusů. Zkus to za chvíli znovu.",
          "Too many attempts. Please try again later.");
    if (error instanceof IdentityService.HttpFailure) {
      String code = ((IdentityService.HttpFailure) error).code;
      if ("invalid_credentials".equals(code))
        return text(
            "E-mail nebo heslo nesouhlasí. Pokud jsi dříve používal/a odkaz, zvol Nastavit nebo"
                + " obnovit heslo.",
            "Incorrect email or password. If you previously signed in by link, select Set or reset"
                + " password.");
      if ("email_address_not_authorized".equals(code))
        return text(
            "Pilot zatím nemůže na tuto adresu poslat zprávu. Obrať se na správce pilotu.",
            "The pilot cannot send to this address yet. Contact the pilot operator.");
      if ("email_not_confirmed".equals(code))
        return text(
            "Nejdřív potvrď e-mail na tomto telefonu.", "Confirm your email on this phone first.");
      if ("weak_password".equals(code))
        return text("Zvol silnější heslo.", "Choose a stronger password.");
      if ("same_password".equals(code))
        return text("Zvol jiné heslo než dosud.", "Choose a different password.");
    }
    if (error instanceof java.security.GeneralSecurityException)
      return text(
          "Odemknutí se nezdařilo. Přihlas se heslem.",
          "Device unlock failed. Sign in with your password.");
    return text(
        "Akci se nepodařilo dokončit. Zkontroluj připojení nebo údaje a opakuj pokus.",
        "Could not complete this step. Check your connection or details, then retry.");
  }
}
