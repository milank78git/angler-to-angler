package app.anglers.journal;

import android.app.Activity;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/** Executes the journal's allowed RPCs and delivers replies only to the original active account. */
final class JournalProfileRequests implements AutoCloseable {
  private final ExecutorService io = Executors.newSingleThreadExecutor();
  private final Activity activity;
  private final String subject;
  private final Consumer<String> evaluate;

  JournalProfileRequests(Activity activity, String subject, Consumer<String> evaluate) {
    this.activity = activity;
    this.subject = subject;
    this.evaluate = evaluate;
  }

  void request(int id, String operation, String body) {
    switch (operation) {
      case "my_details":
      case "profile":
      case "card":
      case "directory":
      case "water_discussion":
      case "discussion_post":
      case "discussion_reply":
      case "discussion_withdraw":
      case "discussion_helpful":
      case "report_content":
      case "discussion_report":
      case "public_card_options":
      case "public_card_publish":
      case "public_card_withdraw":
      case "public_cards":
      case "commerce":
      case "journal_sync":
      case "parking_waters":
      case "parking_list":
      case "parking_save":
      case "parking_feedback":
      case "parking_review":
      case "water_rating":
      case "water_rate":
      case "top_waters":
      case "trip_species":
      case "top_species":
      case "water_report":
      case "water_alerts":
      case "market_discover":
      case "market_list":
      case "market_detail":
      case "market_activate":
      case "market_publish":
      case "market_withdraw":
      case "market_buy":
      case "market_rate":
      case "activity_state":
      case "activity_change":
      case "activity_summary":
      case "activity_mine":
      case "weekly_enter":
      case "weekly_board":
      case "group_monthly":
      case "weekly_vote":
      case "weekly_report":
      case "weekly_withdraw":
      case "message_inbox":
      case "message_history":
      case "message_send":
      case "message_block":
      case "message_report":
      case "message_react":
      case "groups":
      case "group_tip_post":
      case "save_card":
      case "evidence_submit":
      case "evidence_list":
      case "evidence_review":
      case "evidence_decide":
      case "evidence_remove":
        break;
      default:
        return;
    }
    io.execute(
        () -> {
          int status = 200;
          org.json.JSONObject result = null;
          try {
            if (body.length() > 260000) throw new IdentityService.HttpFailure(413);
            result =
                AccountStore.rpc(
                    activity,
                    new IdentityService(activity),
                    subject,
                    operation,
                    new org.json.JSONObject(body));
            if ("my_details".equals(operation)) LicenseReminder.remember(activity, subject, result);
          } catch (IdentityService.HttpFailure error) {
            status = error.status;
          } catch (Exception error) {
            status = 503;
          }
          final int code = status;
          final String payload = result == null ? "null" : result.toString();
          activity.runOnUiThread(
              () -> {
                if (!activity.isFinishing()
                    && !activity.isDestroyed()
                    && subject.equals(AccountStore.active(activity)))
                  evaluate.accept("window.profileReply?.(" + id + "," + code + "," + payload + ")");
              });
        });
  }

  @Override public void close() {
    io.shutdownNow();
  }
}
