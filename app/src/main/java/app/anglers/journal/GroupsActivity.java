package app.anglers.journal;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.text.InputType;
import android.widget.EditText;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Online membership management. No group, invitation or account token is written to disk here. */
public final class GroupsActivity extends Activity {
  private final ExecutorService io = Executors.newSingleThreadExecutor();
  private AccountLayout ui;
  private IdentityService service;
  private String subject;
  private boolean cs, busy, readingTips;
  private AccountLayout.Prompt dialog;
  private EditText dialogInput;

  private String t(String cz, String en) {
    return cs ? cz : en;
  }

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    cs = "cs".equals(getResources().getConfiguration().getLocales().get(0).getLanguage());
    ui = new AccountLayout(this);
    subject = AccountStore.active(this);
    try {
      service = new IdentityService(this, cs);
    } catch (Exception ignored) {
      /* Offer retry on reopen. */
    }
  }

  @Override
  protected void onStart() {
    super.onStart();
    if (!busy) refresh();
  }

  @Override
  protected void onDestroy() {
    io.shutdownNow();
    super.onDestroy();
  }

  private void button(String label, AccountLayout.Action style, Runnable action) {
    ui.button(
        ui.form,
        label,
        style,
        () -> {
          if (!busy) action.run();
        });
  }

  private String title() {
    return t("Rybářské party", "Fishing groups");
  }

  private void signIn() {
    readingTips = false;
    closeDialog();
    ui.page(title(), false);
    ui.label(
        t(
            "Pro správu party se přihlas online. Svůj deník můžeš dál používat.",
            "Sign in online to manage groups. You can still use your journal."));
    button(
        t("Přihlásit se", "Sign in"),
        AccountLayout.Action.PRIMARY,
        () -> {
          startActivity(
              new Intent(this, AccountActivity.class)
                  .putExtra("groupsSignIn", true)
                  .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP));
          finish();
        });
  }

  private void refresh() {
    readingTips = false;
    if (subject.isEmpty() || !subject.equals(AccountStore.active(this))) {
      signIn();
      return;
    }
    ui.page(title(), false);
    button(t("Obnovit seznam", "Refresh groups"), AccountLayout.Action.LINK, this::refresh);
    request("groups", new JSONObject(), result -> render(result.getJSONArray("groups")));
  }

  private void render(JSONArray groups) throws JSONException {
    ui.page(title(), false);
    ui.label(
        t(
            "Na server se ukládá název party, členství a tipy, které do ní odešleš."
                + " Odchodem se smažou i tvé tipy, soutěžní fotky a hlasy.",
            "The service stores the group name, membership and the tips you post to it."
                + " Leaving deletes your tips, competition photos and votes."));
    if (groups.length() == 0)
      ui.label(t("Zatím nejsi v žádné partě.", "You haven’t joined any groups yet."));
    for (int i = 0; i < groups.length(); i++) {
      JSONObject group = groups.getJSONObject(i);
      String id = group.getString("id"), name = group.getString("name");
      boolean owner = group.getBoolean("owner");
      button(
          name + (owner ? t(" · zakladatel", " · owner") : t(" · člen", " · member")),
          AccountLayout.Action.SECONDARY,
          () -> actions(id, name, owner));
      ui.label(t("Počet členů: ", "Members: ") + group.getInt("memberCount"));
    }
    button(t("Založit partu", "Create a group"), AccountLayout.Action.PRIMARY, () -> editor(true));
    button(
        t("Přijmout pozvánku", "Join with a code"),
        AccountLayout.Action.SECONDARY,
        () -> editor(false));
    button(t("Obnovit seznam", "Refresh groups"), AccountLayout.Action.LINK, this::refresh);
  }

  /** Keep the draft and request ID through recoverable network failures. */
  private void editor(boolean create) {
    String id = UUID.randomUUID().toString();
    String action =
        create ? t("Založit partu", "Create a group") : t("Přijmout pozvánku", "Join with a code");
    dialog = ui.prompt(action);
    EditText input =
        dialog.input(
            create
                ? t("Název party (2–60 znaků)", "Group name (2–60 characters)")
                : t("Kód pozvánky", "Invitation code"),
            InputType.TYPE_CLASS_TEXT);
    dialogInput = input;
    dialog.submit(
        action,
        () -> {
          if (busy) return;
          String value = input.getText().toString().trim();
          if (create
              && (value.codePointCount(0, value.length()) < 2
                  || value.codePointCount(0, value.length()) > 60)) {
            input.setError(input.getHint());
            return;
          }
          if (!create && !value.matches("(?i)[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}")) {
            input.setError(t("Vlož celý kód z pozvánky.", "Paste the complete invitation code."));
            return;
          }
          JSONObject args =
              create ? args("group_id", id, "group_name", value) : args("invite_code", value);
          request(
              create ? "group_create" : "group_join",
              args,
              result -> {
                closeDialog();
                refresh();
              });
        });
    dialog.action(t("Zrušit", "Cancel"), AccountLayout.Action.SECONDARY, null);
    dialog.show();
  }

  private void actions(String id, String name, boolean owner) {
    String leave =
        owner ? t("Rozpustit partu", "Dissolve group") : t("Opustit partu", "Leave group");
    dialog = ui.prompt(name);
    dialog.choice(
        t("Tipy party", "Group tips"), AccountLayout.Action.SECONDARY, () -> tips(id, name, null));
    dialog.choice(
        t("Úlovek týdne", "Catch of the week"),
        AccountLayout.Action.SECONDARY,
        () ->
            startActivity(
                new Intent(this, FishingActivity.class)
                    .putExtra(
                        "weeklyDestination", args("groupId", id, "groupName", name).toString())));
    if (owner)
      dialog.choice(
          t("Vystavit pozvánku", "Issue invitation"),
          AccountLayout.Action.PRIMARY,
          () ->
              request(
                  "group_invite",
                  args("group_id", id),
                  result -> invitation(result.getString("code"))));
    dialog.choice(leave, AccountLayout.Action.DANGER, () -> confirmLeave(id, name, owner, leave));
    dialog.action(t("Zavřít", "Close"), AccountLayout.Action.SECONDARY, null);
    dialog.show();
  }

  /** Read a bounded page online. Refresh and Back always work from an empty or failed page. */
  private void tips(String id, String name, String cursor) {
    readingTips = true;
    ui.page(t("Tipy party · ", "Group tips · ") + name, false);
    button(t("Zpět na party", "Back to groups"), AccountLayout.Action.LINK, this::refresh);
    button(
        t("Obnovit tipy", "Refresh tips"),
        AccountLayout.Action.SECONDARY,
        () -> tips(id, name, null));
    JSONObject query = args("group_id", id);
    if (cursor != null) {
      query = args("group_id", id, "before_position", cursor);
      button(
          t("Načíst tuto stránku znovu", "Reload this page"),
          AccountLayout.Action.LINK,
          () -> tips(id, name, cursor));
    }
    request(
        "group_tips",
        query,
        result -> {
          JSONArray items = result.getJSONArray("tips");
          if (items.length() == 0) ui.label(t("Zatím tu nejsou žádné tipy.", "No tips here yet."));
          java.text.DateFormat dates =
              java.text.DateFormat.getDateTimeInstance(
                  java.text.DateFormat.MEDIUM,
                  java.text.DateFormat.SHORT,
                  getResources().getConfiguration().getLocales().get(0));
          for (int i = 0; i < items.length(); i++) {
            JSONObject tip = items.getJSONObject(i);
            ui.tip(
                tip.getString("author")
                    + " · "
                    + dates.format(new java.util.Date(tip.getLong("postedAt"))),
                tip.getString("text"));
          }
          if (!result.isNull("next")) {
            String next = result.getString("next");
            button(
                t("Starší tipy", "Older tips"),
                AccountLayout.Action.SECONDARY,
                () -> tips(id, name, next));
          }
        });
  }

  @Override
  public void onBackPressed() {
    if (readingTips && !busy) refresh();
    else super.onBackPressed();
  }

  private void confirmLeave(String id, String name, boolean owner, String leave) {
    dialog = ui.prompt(leave + "?");
    dialog.description(
        owner
            ? t(
                "Parta „" + name + "“ se smaže včetně tipů, soutěžních fotek, hlasů a pozvánky.",
                "Dissolving “"
                    + name
                    + "” deletes the group tips, competition photos, votes and invitation.")
            : t(
                "Tvoje členství v partě „"
                    + name
                    + "“ skončí a smažou se tvé tipy, soutěžní fotky i hlasy.",
                "Your membership in “"
                    + name
                    + "” will end and your tips, competition photos and votes will be deleted."));
    dialog.action(
        leave,
        AccountLayout.Action.DANGER,
        () ->
            request(
                owner ? "group_dissolve" : "group_leave",
                args("group_id", id),
                result -> refresh()));
    dialog.action(t("Zrušit", "Cancel"), AccountLayout.Action.SECONDARY, null);
    dialog.show();
  }

  private void invitation(String code) {
    dialog = ui.prompt(t("Pozvánka pro jednoho rybáře", "Invite one angler"));
    dialog.code(code);
    dialog.description(
        t(
            "Kód platí 24 hodin. Nový kód nahradí předchozí.",
            "The code lasts 24 hours. A new code replaces the previous one."));
    dialog.action(
        t("Sdílet kód", "Share code"),
        AccountLayout.Action.PRIMARY,
        () ->
            startActivity(
                Intent.createChooser(
                    new Intent(Intent.ACTION_SEND)
                        .setType("text/plain")
                        .putExtra(Intent.EXTRA_TEXT, code),
                    null)));
    dialog.action(t("Zavřít", "Close"), AccountLayout.Action.SECONDARY, null);
    dialog.show();
  }

  private void closeDialog() {
    if (dialog != null) dialog.dismiss();
    dialog = null;
    dialogInput = null;
  }

  private static JSONObject args(String... pairs) {
    JSONObject json = new JSONObject();
    try {
      for (int i = 0; i < pairs.length; i += 2) json.put(pairs[i], pairs[i + 1]);
    } catch (JSONException impossible) {
      throw new IllegalArgumentException(impossible);
    }
    return json;
  }

  private interface Result {
    void show(JSONObject response) throws JSONException;
  }

  /** Bind each request and its response to the same in-memory verified session. */
  private void request(String method, JSONObject args, Result result) {
    if (busy) return;
    if (subject.isEmpty() || !subject.equals(AccountStore.active(this))) {
      signIn();
      return;
    }
    if (service == null) {
      ui.message(t("Konfigurace účtu není dostupná.", "Account configuration is unavailable."));
      return;
    }
    busy = true;
    ui.message(t("Připojuji se…", "Connecting…"));
    io.execute(
        () -> {
          JSONObject value = null;
          int status = 0;
          try {
            value = AccountStore.rpc(this, service, subject, method, args);
          } catch (IdentityService.HttpFailure e) {
            status = e.status;
          } catch (Exception ignored) {
            /* Show a retryable connection error. */
          }
          final JSONObject response = value;
          final int http = status;
          runOnUiThread(
              () -> {
                if (isDestroyed() || isFinishing()) return;
                busy = false;
                if (!subject.equals(AccountStore.active(this))) {
                  signIn();
                  return;
                }
                if (http == 401) {
                  signIn();
                  return;
                }
                if (response != null) {
                  try {
                    ui.message("");
                    result.show(response);
                    return;
                  } catch (JSONException ignored) {
                    /* Unexpected response. */
                  }
                }
                String error =
                    http == 400 && method.equals("group_join")
                        ? t(
                            "Pozvánka je neplatná, použitá nebo vypršela.",
                            "This invitation is invalid, already used or expired.")
                        : http == 403
                            ? t(
                                "K této akci nemáš oprávnění.",
                                "You do not have permission for this action.")
                            : t(
                                "Akci se nepodařilo ověřit. Zkontroluj připojení a zkus to znovu.",
                                "Could not confirm the change. Check your connection and retry.");
                if (dialog != null
                    && dialog.isShowing()
                    && dialogInput != null
                    && dialogInput.isShown()) dialogInput.setError(error);
                ui.message(error);
              });
        });
  }
}
