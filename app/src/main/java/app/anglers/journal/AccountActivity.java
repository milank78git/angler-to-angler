package app.anglers.journal;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.*;
import org.json.JSONObject;

/**
 * The launcher and account UI. The journal opens only after the server confirms the profile and
 * both revisions.
 */
public final class AccountActivity extends LocalizedActivity {
  private final AccountRequests requests = new AccountRequests(this);
  private IdentityService service;
  private AccountLayout ui;
  private AccountDocuments documents;
  private Button submit;
  private boolean groupLogin, profileLogin;
  private String email = "";
  private IdentityService.Session signing;
  private android.os.CancellationSignal prompt;
  private boolean managing;
  private JSONObject profile;

  private String text(String key) {
    return AppLanguage.text(this, key);
  }

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    try {
      service = new IdentityService(this);
    } catch (Exception ignored) {
      /* Show the unavailable state. */
    }
    SharedPreferences pending = AccountStore.prefs(this);
    groupLogin = getIntent().getBooleanExtra("groupsSignIn", false);
    profileLogin = getIntent().getBooleanExtra("profileSignIn", false);
    if (!groupLogin && !profileLogin && PendingSignIn.fresh(pending)) {
      groupLogin = pending.getBoolean("pkceForGroups", false);
      profileLogin = pending.getBoolean("pkceForProfile", false);
    }
    ui = new AccountLayout(this);
    documents = new AccountDocuments(this, ui, service == null ? "" : service.notice);
    email = pending.getString("pkceEmail", pending.getString("email", ""));
    if (getIntent().getData() != null) {
      if (PendingSignIn.fresh(pending) && !email.isEmpty()) inbox();
      else login();
      callback(getIntent());
    } else if (!groupLogin && !profileLogin && !AccountStore.active(this).isEmpty()) {
      if (getIntent().getBooleanExtra("manage", false)) manage();
      else enter();
    } else if (PendingSignIn.fresh(pending)
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
    if (intent.hasExtra("fieldAlert") && !AccountStore.active(this).isEmpty()) { enter(); return; }
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
    requests.close();
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
          if (!requests.busy()) handler.run();
        });
  }

  private void documents() {
    action(text("account.terms_and_privacy"), AccountLayout.Action.LINK, documents::open);
  }

  private void login() {
    signing = null;
    managing = false;
    profile = null;
    ui.page(text("account.account_sign_in"), true);
    boolean ready = service != null && service.configured();
    if (DeviceVault.enrolled(this))
      action(
          text("account.unlock_with_device"),
          AccountLayout.Action.PRIMARY,
          this::unlock);
    EditText address = addressField(text("account.enter_the_email_address_for_your_account"));
    EditText password = passwordField(false);
    Button send =
        action(
            text("common.sign_in"),
            AccountLayout.Action.PRIMARY,
            () -> {
              if (!readAddress(address) || !validPassword(password, false)) return;
              String secret = password.getText().toString();
              run(() -> service.signIn(email, secret), this::verified);
            });
    // Keep the original confirmation usable if password sign-in happens before verification.
    SharedPreferences pending = AccountStore.prefs(this);
    if (PendingSignIn.fresh(pending) && "signup".equals(pending.getString("pkcePurpose", ""))
        && pending.getBoolean("pkceMailAccepted", true)) {
      action(text("account.return_to_confirmation"), AccountLayout.Action.LINK, () -> {
        email = pending.getString("pkceEmail", "");
        inbox();
      });
    }
    send.setEnabled(ready);
    password.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_GO);
    password.setOnEditorActionListener(
        (v, id, e) ->
            id == android.view.inputmethod.EditorInfo.IME_ACTION_GO && send.performClick());
    action(
            text("account.create_account"),
            AccountLayout.Action.SECONDARY,
            () -> {
              email = address.getText().toString().trim();
              emailForm(false);
            })
        .setEnabled(ready);
    action(
            text("account.set_or_reset_password"),
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
      ui.message(text("account.sign_in_is_currently_unavailable"));
    documents();
    action(text("settings.language"), AccountLayout.Action.LINK, () -> AppLanguage.pick(this));
  }

  /**
   * Discover enabled providers once for this page without blocking email or a returning callback.
   */
  private void loadProviders(LinearLayout social, Button emailButton) {
    requests.discoverProviders(service, enabled -> {
      if (social.getParent() != ui.form) return;
      if (enabled.has("email")) emailButton.setEnabled(enabled.optBoolean("email"));
      for (String provider : new String[] {"google", "facebook"}) {
        if (!enabled.optBoolean(provider)) continue;
        String name = provider.equals("google") ? "Google" : "Facebook";
        Button button =
            ui.button(
                social,
                text("account.continue_with") + name,
                AccountLayout.Action.SECONDARY,
                () -> {
                  if (!requests.busy()) oauth(provider);
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
  }

  private EditText addressField(String explanation) {
    EditText field =
        ui.field(
            text("account.email"),
            InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
    ui.explain(field.getHint().toString(), explanation, field);
    field.setAutofillHints(View.AUTOFILL_HINT_USERNAME, View.AUTOFILL_HINT_EMAIL_ADDRESS);
    field.setText(email);
    return field;
  }

  private boolean readAddress(EditText field) {
    String value = field.getText().toString().trim();
    if (!android.util.Patterns.EMAIL_ADDRESS.matcher(value).matches()) {
      field.setError(text("account.check_the_address"));
      return false;
    }
    email = value;
    return true;
  }

  private EditText passwordField(boolean fresh) {
    EditText field =
        ui.field(
            fresh ? text("account.new_password") : text("account.password"),
            InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
    ui.explain(field.getHint().toString(), fresh
        ? text("account.choose_a_password_of_at_least_8")
        : text("account.enter_the_password_set_at_registration_use"), field);
    field.setSaveEnabled(false);
    field.setAutofillHints(fresh ? "newPassword" : View.AUTOFILL_HINT_PASSWORD);
    return field;
  }

  private boolean validPassword(EditText field, boolean fresh) {
    String value = field.getText().toString();
    if (!value.isEmpty() && (!fresh || value.codePointCount(0, value.length()) >= 8)) return true;
    field.setError(
        fresh
            ? text("account.use_at_least_8_characters")
            : text("account.enter_your_password"));
    return false;
  }

  private void emailForm(boolean recovery) {
    ui.page(
        recovery ? text("account.password_setup") : text("account.registration"),
        false);
    ui.label(
        recovery
            ? text("account.if_you_already_have_an_account_well")
            : text("account.choose_a_password_with_at_least_8"));
    EditText address = addressField(recovery
        ? text("account.the_password_reset_link_will_go_to")
        : text("account.enter_an_email_address_where_you_can"));
    EditText password = recovery ? null : passwordField(true);
    action(
        recovery
            ? text("account.send_password_setup_link")
            : text("account.register"),
        AccountLayout.Action.PRIMARY,
        () -> {
          if (!readAddress(address) || (!recovery && !validPassword(password, true))) return;
          String purpose = recovery ? "recovery" : "signup";
          SharedPreferences p = AccountStore.prefs(this);
          String verifier =
              PendingSignIn.fresh(p)
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
                }
              });
        });
    action(text("account.back_to_sign_in"), AccountLayout.Action.LINK, this::login);
  }

  private void choosePassword(IdentityService.Session recovery) {
    PendingSignIn.clear(AccountStore.prefs(this));
    ui.page(text("account.set_a_new_password"), false);
    EditText field = passwordField(true);
    action(
        text("account.save_password"),
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
    action(text("account.back_to_sign_in"), AccountLayout.Action.LINK, this::login);
  }

  /** Use the OS authentication UI and a Keystore-protected key on the same device. */
  private void unlock() {
    if (requests.busy() || prompt != null || !DeviceVault.enrolled(this)) return;
    String title = text("account.unlock_journal");
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
    String purpose = AccountStore.prefs(this).getString("pkcePurpose", "");
    boolean signup = "signup".equals(purpose);
    ui.page(text("account.check_your_email"), false);
    ui.label(signup ? text("account.signup_confirmation_help").replace("{email}", email)
        : text("account.open_the_latest_message_sent_to")
            + email
            + text("account.and_tap_the_link_on_this_phone"));
    action(
        text("account.open_inbox"),
        AccountLayout.Action.PRIMARY,
        () -> {
          try {
            startActivity(
                Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_EMAIL)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
          } catch (ActivityNotFoundException missing) {
            ui.message(
                text("account.open_your_webmail_in_the_browser_on"));
          }
        });
    if (signup)
      action(text("account.confirmed_sign_in"), AccountLayout.Action.SECONDARY, this::login);
    if (signup || "recovery".equals(purpose))
      action(
          text("account.request_another_link"),
          AccountLayout.Action.SECONDARY,
          () -> resendEmail(purpose));
    if (!signup)
      action(
          text("account.back_to_sign_in"),
          AccountLayout.Action.LINK,
          () -> {
            PendingSignIn.clear(AccountStore.prefs(this));
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
              text("account.new_link_requested_check_your_inbox"));
        });
  }

  private boolean savePending(String verifier, String address, String purpose) {
    boolean saved = PendingSignIn.save(AccountStore.prefs(this), verifier, address, purpose, groupLogin, profileLogin);
    if (!saved) ui.message(text("account.could_not_save_the_sign_in_request"));
    return saved;
  }

  private String expiredEmailMessage() {
    return text("account.this_link_was_already_used_or_has");
  }

  private void oauth(String provider) {
    try {
      String verifier = IdentityService.verifier();
      Uri url = service.authorize(provider, verifier);
      if (!savePending(verifier, "", "oauth")) return;
      startActivity(new Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE));
    } catch (Exception e) {
      ui.message(text("account.could_not_open_a_browser"));
    }
  }

  private void callback(Intent intent) {
    Uri uri = intent.getData();
    if (uri == null || service == null || requests.busy()) return;
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
      android.util.Log.i("AnglerAuth", "Email callback expired or already used");
      ui.message(expiredEmailMessage());
      return;
    }
    String code = uri.getQueryParameter("code");
    if (!service.configured()
        || !PendingSignIn.fresh(p)
        || verifier.isEmpty()
        || code == null
        || code.isEmpty()) {
      ui.message(
          text("account.sign_in_was_not_completed_please_retry"));
      return;
    }
    android.util.Log.i("AnglerAuth", "Exchanging pending email or provider callback");
    boolean recovery = "recovery".equals(p.getString("pkcePurpose", ""));
    run(
        () -> service.exchange(code, verifier, expectedEmail),
        session -> {
          if (recovery) choosePassword(session);
          else verified(session);
        });
  }

  private void verified(IdentityService.Session auth) {
    PendingSignIn.clear(AccountStore.prefs(this));
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
    ui.page(text("account.angler_profile"), false);
    EditText nickname =
        ui.field(
            text("account.display_name_2_60_characters"),
            InputType.TYPE_CLASS_TEXT);
    ui.explain(nickname.getHint().toString(), text("account.other_anglers_will_see_this_display_name"), nickname);
    if (profile.has("name")) {
      nickname.setText(profile.optString("name"));
      nickname.setEnabled(false);
    }
    ui.message(text("sync.new_account"));
    CheckBox terms = ui.check(text("account.i_accept_the_terms_of_use"));
    CheckBox privacy =
        ui.check(
            text("account.i_acknowledge_the_privacy_notice"));
    submit =
        action(
            text("common.save_profile"),
            AccountLayout.Action.PRIMARY,
            () -> {
              String name = nickname.getText().toString().trim();
              if (name.codePointCount(0, name.length()) < 2
                  || name.codePointCount(0, name.length()) > 60) {
                nickname.setError(text("account.enter_2_to_60_characters"));
                return;
              }
              if (!terms.isChecked() || !privacy.isChecked()) return;
              run(() -> service.accept(signing.access, name), result -> {
                if (signing.id.equals(result.optString("id")) && result.optBoolean("current")) {
                  AccountStore.prefs(this).edit().putBoolean("cloudJournal." + signing.id, true).apply();
                }
                finishProfile(result);
              });
            });
    submit.setEnabled(false);
    CompoundButton.OnCheckedChangeListener update =
        (box, value) -> submit.setEnabled(terms.isChecked() && privacy.isChecked());
    terms.setOnCheckedChangeListener(update);
    privacy.setOnCheckedChangeListener(update);
    documents();
    action(text("account.back_to_sign_in"), AccountLayout.Action.LINK, this::login);
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
        ui.prompt(text("account.journal_from_an_older_version"));
    journal.description(
        text("account.does_the_earlier_journal_on_this_device"));
    journal.setCancelable(false);
    journal.action(
        text("account.link_my_journal"),
        AccountLayout.Action.PRIMARY,
        () -> activate(result, true));
    journal.action(text("account.fresh_journal"), AccountLayout.Action.SECONDARY, fresh);
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
    Intent journal=new Intent(this,FishingActivity.class).putExtra("openProfile",profileLogin)
        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
    if (AccountStore.active(this).equals(getIntent().getStringExtra("fieldOwner")))
      journal.putExtra("fieldAlert",getIntent().getStringExtra("fieldAlert"))
          .putExtra("fieldWater",getIntent().getStringExtra("fieldWater"));
    startActivity(journal);
    finish();
  }

  private void manage() {
    managing = true;
    ui.page(AccountStore.prefs(this).getString("name", ""), false);
    ui.label(
        text("account.for_account_correction_access_or_deletion_contact"));
    action(text("store.deletion_request"), AccountLayout.Action.SECONDARY,
        () -> startActivity(new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(
            "https://milank78git.github.io/angler-to-angler/delete-account/"))));
    action(text("common.water_atlas_updates"), AccountLayout.Action.SECONDARY,
        () -> startActivity(new Intent(this, WaterSettingsActivity.class)));
    action(
        text("common.fishing_groups"),
        AccountLayout.Action.PRIMARY,
        () -> startActivity(new Intent(this, GroupsActivity.class)));
    action(
        text("account.sign_out_on_this_phone"),
        AccountLayout.Action.SECONDARY,
        () -> {
          PendingSignIn.clear(AccountStore.prefs(this));
          IdentityService.Session previous = AccountStore.logout(this);
          IdentityService auth = service;
          if (auth != null && previous != null) {
            new Thread(() -> {
              try {
                auth.signOut(previous);
              } catch (Exception offline) {
                android.util.Log.i("AnglerAuth", "Could not confirm remote sign-out");
              }
            }, "angler-sign-out").start();
          }
          email = "";
          login();
        });
    action(text("account.open_journal"), AccountLayout.Action.PRIMARY, this::enter);
    documents();
  }

  private <T> void run(java.util.concurrent.Callable<T> work, java.util.function.Consumer<T> done) {
    requests.run(work, value -> { ui.message(""); done.accept(value); },
        error -> ui.message(errorMessage(error)),
        () -> ui.message(text("account.contacting_account_service")), () -> callback(getIntent()));
  }

  private String errorMessage(Exception error) {
    if (error instanceof IdentityService.EmailRateLimit)
      return text("account.too_many_attempts_please_try_again_later");
    if (error instanceof IdentityService.HttpFailure) {
      String code = ((IdentityService.HttpFailure) error).code;
      if ("PT409".equals(code)) return text("account.name_in_use");
      if ("23514".equals(code)) return text("account.visible_name_required");
      if ("invalid_credentials".equals(code))
        return text("account.incorrect_email_or_password_if_you_previously");
      if ("email_address_not_authorized".equals(code))
        return text("account.the_pilot_cannot_send_to_this_address");
      if ("email_not_confirmed".equals(code))
        return text("account.confirm_your_email_on_this_phone_first");
      if ("weak_password".equals(code))
        return text("account.choose_a_stronger_password");
      if ("same_password".equals(code))
        return text("account.choose_a_different_password");
    }
    if (error instanceof java.security.GeneralSecurityException)
      return text("account.device_unlock_failed_sign_in_with_your");
    return text("account.could_not_complete_this_step_check_your");
  }
}
