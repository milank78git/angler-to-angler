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
    request("groups", new JSONObject(), result -> {
      if (result.has("ageBand"))
        AccountStore.prefs(this).edit().putString("ageBand", result.getString("ageBand")).apply();
      render(result.getJSONArray("groups"));
      if (getIntent().hasExtra("invite")) {
        editor(false);
        dialogInput.setText(getIntent().getStringExtra("invite"));
        getIntent().removeExtra("invite");
      }
    });
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
          () -> actions(id, name, owner, group.optBoolean("canShareTip", true), group.optBoolean("canShareCatch", true)));
      ui.label(t("groups.members") + group.getInt("memberCount"));
    }
    if ("adult".equals(AccountStore.prefs(this).getString("ageBand", ""))) {
      button(t("groups.create_a_group"), AccountLayout.Action.PRIMARY, () -> editor(true));
      button(t("age.family_settings"), AccountLayout.Action.SECONDARY, this::familySettings);
    } else {
      ui.label(t("age.group_rule"));
    }
    button(
        t("groups.join_with_a_code"),
        AccountLayout.Action.SECONDARY,
        () -> editor(false));
    button(t("groups.refresh_groups"), AccountLayout.Action.LINK, this::refresh);
  }

  /** Show only the child memberships linked to this independently verified guardian. */
  private void familySettings() {
    request("family_permissions", new JSONObject(), result -> {
      readingTips = true;
      ui.page(t("age.family_settings"), false);
      ui.label(t("age.link_help"));
      button(t("groups.back_to_groups"), AccountLayout.Action.LINK, this::refresh);
      JSONArray items = result.getJSONArray("items");
      for (int i = 0; i < items.length(); i++) {
        JSONObject item = items.getJSONObject(i);
        String destination = item.getString("name") + " · " + item.getString("groupName");
        ui.label(destination);
        for (String kind : new String[] {"catch", "tip"}) {
          boolean allowed = item.getBoolean(kind);
          String feature = t(kind.equals("catch") ? "age.catches" : "age.tips");
          String change = t(allowed ? "age.withdraw" : "age.allow") + " · " + feature;
          JSONObject args = args("child_id", item.getString("child"), "target", item.getString("group"), "feature", kind);
          args.put("allowed", !allowed);
          button(change, AccountLayout.Action.SECONDARY, () -> {
            dialog = ui.prompt(change);
            dialog.description(destination + "\n" + t(allowed ? "age.withdraw_info" : "age.grant_info"));
            dialog.action(change, allowed ? AccountLayout.Action.DANGER : AccountLayout.Action.PRIMARY,
                () -> request("family_permission", args, receipt -> familySettings()));
            dialog.action(t("common.cancel"), AccountLayout.Action.SECONDARY, null);
            dialog.show();
          });
        }
      }
    });
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

  private void actions(String id, String name, boolean owner, boolean tipsAllowed, boolean catchesAllowed) {
    String leave =
        owner ? t("groups.dissolve_group") : t("groups.leave_group");
    dialog = ui.prompt(name);
    if (catchesAllowed) dialog.choice(t("age.catches"), AccountLayout.Action.SECONDARY, () -> catches(id, name, null));
    if (tipsAllowed) dialog.choice(
        t("groups.group_tips"), AccountLayout.Action.SECONDARY, () -> tips(id, name, null));
    if (catchesAllowed) dialog.choice(
        t("common.catch_of_the_week"),
        AccountLayout.Action.SECONDARY,
        () ->
            startActivity(
                new Intent(this, FishingActivity.class)
                    .putExtra(
                        "weeklyDestination", args("groupId", id, "groupName", name).toString())));
    if (owner) {
      dialog.choice(t("groups.member_list"), AccountLayout.Action.SECONDARY, () -> members(id, name, null));
      dialog.choice(t("public_cards.revoke_link"), AccountLayout.Action.SECONDARY, () -> {
        AccountLayout.Prompt confirm = ui.prompt(name);
        confirm.action(t("public_cards.revoke_link"), AccountLayout.Action.DANGER,
            () -> request("group_revoke", args("group_id", id), ignored -> refresh()));
        confirm.action(t("common.cancel"), AccountLayout.Action.SECONDARY, null);
        confirm.show();
      });
      dialog.choice(
          t("groups.issue_invitation"),
          AccountLayout.Action.PRIMARY,
          () ->
              request(
                  "group_link",
                  args("group_id", id),
                  result -> invitation(result.getString("code"))));
    }
    dialog.choice(leave, AccountLayout.Action.DANGER, () -> confirmLeave(id, name, owner, leave));
    dialog.action(t("common.close"), AccountLayout.Action.SECONDARY, null);
    dialog.show();
  }

  private void members(String groupId, String groupName, String after) {
    JSONObject query = after == null ? args("group_id", groupId) : args("group_id", groupId, "after_id", after);
    request("group_members", query, result -> {
      readingTips = true;
      ui.page(t("groups.member_list") + " · " + groupName, false);
      button(t("groups.back_to_groups"), AccountLayout.Action.LINK, this::refresh);
      JSONArray items = result.getJSONArray("items");
      if (after == null) {
        ui.label(result.getString("ownerName") + t("groups.owner"));
        if (items.length() == 0) ui.label(t("groups.members") + "1");
      }
      for (int i = 0; i < items.length(); i++) {
        JSONObject item = items.getJSONObject(i);
        String id = item.getString("id"), name = item.getString("name");
        button(name, AccountLayout.Action.SECONDARY, () -> {
          AccountLayout.Prompt confirm = ui.prompt(name);
          confirm.description(t("groups.remove_member_confirm"));
          confirm.action(t("groups.remove_member"), AccountLayout.Action.DANGER,
              () -> request("group_remove_member", args("group_id", groupId, "member_id", id),
                  ignored -> members(groupId, groupName, null)));
          confirm.action(t("common.cancel"), AccountLayout.Action.SECONDARY, null);
          confirm.show();
        });
      }
      if (!result.isNull("next")) {
        String next = result.getString("next");
        button(t("groups.more_members"), AccountLayout.Action.LINK, () -> members(groupId, groupName, next));
      }
    });
  }

  private void catches(String id, String name, String cursor) {
    readingTips = true;
    ui.page(t("age.catches") + " · " + name, false);
    button(t("groups.back_to_groups"), AccountLayout.Action.LINK, this::refresh);
    JSONObject query = cursor == null ? args("group_id", id) : args("group_id", id, "before_position", cursor);
    request("group_catches", query, result -> {
      JSONArray items = result.getJSONArray("items");
      if (items.length() == 0) ui.label(t("age.empty_catches"));
      for (int i = 0; i < items.length(); i++) {
        JSONObject item = items.getJSONObject(i);
        String length = item.isNull("mm") ? "" : " · " + item.getInt("mm") + " mm";
        ui.tip(item.getString("author") + " · " + item.getString("day"), item.getString("species") + length);
        if (!item.isNull("photo")) ui.catchPhoto(item.getString("photo"), item.getString("species"));
        if (item.optBoolean("canReport")) {
          String position = item.getString("position");
          button(t("moderation.report"), AccountLayout.Action.SECONDARY,
              () -> request("group_catch_report", args("group_id", id, "post_position", position),
                  ignored -> ui.message(t("group_catch.reported"))));
        }
        if (item.optBoolean("canRemove")) {
          String position = item.getString("position");
          String species = item.getString("species");
          button(t("group_catch.remove"), AccountLayout.Action.DANGER, () -> {
            AccountLayout.Prompt confirm = ui.prompt(species);
            confirm.description(t("group_catch.confirm_remove"));
            confirm.action(t("common.cancel"), AccountLayout.Action.SECONDARY, null);
            confirm.action(t("group_catch.remove"), AccountLayout.Action.DANGER,
                () -> request("group_catch_remove", args("group_id", id, "post_position", position),
                    ignored -> catches(id, name, cursor)));
            confirm.show();
          });
        }
      }
      if (!result.isNull("next")) {
        String next = result.getString("next");
        button(t("age.older_catches"), AccountLayout.Action.LINK, () -> catches(id, name, next));
      }
    });
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
            if (tip.optBoolean("mine")) button(t("groups.edit_tip"), AccountLayout.Action.SECONDARY,
                () -> tipAction(id, name, cursor, tip, "edit"));
            else if (tip.has("position")) button(t("moderation.report"), AccountLayout.Action.SECONDARY,
                () -> tipAction(id, name, cursor, tip, "report"));
            if (tip.optBoolean("canRemove")) button(t("groups.remove_tip"), AccountLayout.Action.DANGER,
                () -> tipAction(id, name, cursor, tip, "remove"));
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

  private void tipAction(String group, String name, String cursor, JSONObject tip, String action) {
    boolean edit = action.equals("edit"), remove = action.equals("remove");
    String label = t(edit ? "groups.edit_tip" : remove ? "groups.remove_tip" : "moderation.report");
    dialog = ui.prompt(label);
    String previous = tip.optString("text");
    EditText input = edit ? dialog.input(label, InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE) : null;
    if (edit) input.setText(previous);
    else dialog.description(previous);
    dialogInput = input;
    dialog.submit(label, () -> {
      JSONObject change = args("group_id", group, "post_position", tip.optString("position"), "action", action);
      if (edit) {
        String value = input.getText().toString().trim();
        if (value.isEmpty() || value.codePointCount(0, value.length()) > 4096) { input.setError(label); return; }
        change = args("group_id", group, "post_position", tip.optString("position"), "action", action,
            "message", value, "previous", previous);
      }
      request("group_tip_change", change, ignored -> {
        closeDialog();
        if (action.equals("report")) ui.message(t("common.reported"));
        else tips(group, name, cursor);
      });
    });
    dialog.action(t("common.cancel"), AccountLayout.Action.SECONDARY, null);
    dialog.show();
  }

  private void invitation(String code) {
    dialog = ui.prompt(t("groups.issue_invitation"));
    dialog.code(code);
    dialog.description(
        t("groups.the_code_lasts_24_hours_a_new"));
    dialog.action(
        t("public_cards.share_link"),
        AccountLayout.Action.PRIMARY,
        () ->
            startActivity(
                Intent.createChooser(
                    new Intent(Intent.ACTION_SEND)
                        .setType("text/plain")
                        .putExtra(Intent.EXTRA_TEXT, "https://milank78git.github.io/angler-to-angler/invite/#" + code),
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
                    http == 429 ? t("limits.hourly") : http == 400 && method.equals("group_join")
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
