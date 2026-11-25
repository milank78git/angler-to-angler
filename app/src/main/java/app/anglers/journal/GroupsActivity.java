package app.anglers.journal;

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
public final class GroupsActivity extends LocalizedActivity {
  private final ExecutorService io = Executors.newSingleThreadExecutor();
  private AccountLayout ui;
  private IdentityService service;
  private String subject;
  private boolean busy, readingTips;
  private AccountLayout.Prompt dialog;
  private EditText dialogInput;

  private String t(String key) {
    return AppLanguage.text(this, key);
  }

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    ui = new AccountLayout(this);
    subject = AccountStore.active(this);
    try {
      service = new IdentityService(this);
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
    return t("common.fishing_groups");
  }

  private void signIn() {
    readingTips = false;
    closeDialog();
    ui.page(title(), false);
    ui.label(
        t("groups.sign_in_online_to_manage_groups_you"));
    button(
        t("common.sign_in"),
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
    button(t("groups.refresh_groups"), AccountLayout.Action.LINK, this::refresh);
    request("groups", new JSONObject(), result -> render(result.getJSONArray("groups")));
  }

  private void render(JSONArray groups) throws JSONException {
    ui.page(title(), false);
    ui.label(
        t("groups.the_service_stores_the_group_name_membership"));
    if (groups.length() == 0)
      ui.label(t("groups.you_havent_joined_any_groups_yet"));
    for (int i = 0; i < groups.length(); i++) {
      JSONObject group = groups.getJSONObject(i);
      String id = group.getString("id"), name = group.getString("name");
      boolean owner = group.getBoolean("owner");
      button(
          name + (owner ? t("groups.owner") : t("groups.member")),
          AccountLayout.Action.SECONDARY,
          () -> actions(id, name, owner));
      ui.label(t("groups.members") + group.getInt("memberCount"));
    }
    button(t("groups.create_a_group"), AccountLayout.Action.PRIMARY, () -> editor(true));
    button(
        t("groups.join_with_a_code"),
        AccountLayout.Action.SECONDARY,
        () -> editor(false));
    button(t("groups.refresh_groups"), AccountLayout.Action.LINK, this::refresh);
  }

  /** Keep the draft and request ID through recoverable network failures. */
  private void editor(boolean create) {
    String id = UUID.randomUUID().toString();
    String action =
        create ? t("groups.create_a_group") : t("groups.join_with_a_code");
    dialog = ui.prompt(action);
    EditText input =
        dialog.input(
            create
                ? t("groups.group_name_2_60_characters")
                : t("groups.invitation_code"),
            InputType.TYPE_CLASS_TEXT);
    ui.explain(input.getHint().toString(), create
        ? t("groups.group_members_will_see_this_name")
        : t("groups.enter_the_code_shared_by_the_group"), input);
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
            input.setError(t("groups.paste_the_complete_invitation_code"));
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
    dialog.action(t("common.cancel"), AccountLayout.Action.SECONDARY, null);
    dialog.show();
  }

  private void actions(String id, String name, boolean owner) {
    String leave =
        owner ? t("groups.dissolve_group") : t("groups.leave_group");
    dialog = ui.prompt(name);
    dialog.choice(
        t("groups.group_tips"), AccountLayout.Action.SECONDARY, () -> tips(id, name, null));
    dialog.choice(
        t("common.catch_of_the_week"),
        AccountLayout.Action.SECONDARY,
        () ->
            startActivity(
                new Intent(this, FishingActivity.class)
                    .putExtra(
                        "weeklyDestination", args("groupId", id, "groupName", name).toString())));
    if (owner)
      dialog.choice(
          t("groups.issue_invitation"),
          AccountLayout.Action.PRIMARY,
          () ->
              request(
                  "group_invite",
                  args("group_id", id),
                  result -> invitation(result.getString("code"))));
    dialog.choice(leave, AccountLayout.Action.DANGER, () -> confirmLeave(id, name, owner, leave));
    dialog.action(t("common.close"), AccountLayout.Action.SECONDARY, null);
    dialog.show();
  }

  /** Read a bounded page online. Refresh and Back always work from an empty or failed page. */
  private void tips(String id, String name, String cursor) {
    readingTips = true;
    ui.page(t("groups.group_tips_label") + name, false);
    button(t("groups.back_to_groups"), AccountLayout.Action.LINK, this::refresh);
    button(
        t("groups.refresh_tips"),
        AccountLayout.Action.SECONDARY,
        () -> tips(id, name, null));
    JSONObject query = args("group_id", id);
    if (cursor != null) {
      query = args("group_id", id, "before_position", cursor);
      button(
          t("groups.reload_this_page"),
          AccountLayout.Action.LINK,
          () -> tips(id, name, cursor));
    }
    request(
        "group_tips",
        query,
        result -> {
          JSONArray items = result.getJSONArray("tips");
          if (items.length() == 0) ui.label(t("common.no_tips_here_yet"));
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
                t("groups.older_tips"),
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
            ? t("groups.dissolve.description").replace("{name}", name)
            : t("groups.leave.description").replace("{name}", name));
    dialog.action(
        leave,
        AccountLayout.Action.DANGER,
        () ->
            request(
                owner ? "group_dissolve" : "group_leave",
                args("group_id", id),
                result -> refresh()));
    dialog.action(t("common.cancel"), AccountLayout.Action.SECONDARY, null);
    dialog.show();
  }

  private void invitation(String code) {
    dialog = ui.prompt(t("groups.invite_one_angler"));
    dialog.code(code);
    dialog.description(
        t("groups.the_code_lasts_24_hours_a_new"));
    dialog.action(
        t("groups.share_code"),
        AccountLayout.Action.PRIMARY,
        () ->
            startActivity(
                Intent.createChooser(
                    new Intent(Intent.ACTION_SEND)
                        .setType("text/plain")
                        .putExtra(Intent.EXTRA_TEXT, code),
                    null)));
    dialog.action(t("common.close"), AccountLayout.Action.SECONDARY, null);
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
      ui.message(t("groups.account_configuration_is_unavailable"));
      return;
    }
    busy = true;
    ui.message(t("groups.connecting"));
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
                        ? t("groups.this_invitation_is_invalid_already_used_or")
                        : http == 403
                            ? t("groups.you_do_not_have_permission_for_this")
                            : t("groups.could_not_confirm_the_change_check_your");
                if (dialog != null
                    && dialog.isShowing()
                    && dialogInput != null
                    && dialogInput.isShown()) dialogInput.setError(error);
                ui.message(error);
              });
        });
  }
}
