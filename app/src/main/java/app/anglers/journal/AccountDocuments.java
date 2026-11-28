package app.anglers.journal;

import android.app.Activity;

/** Displays the account documents, packaged licenses and the deployment-specific privacy notice. */
final class AccountDocuments {
  private final Activity activity;
  private final AccountLayout ui;
  private final String deploymentNotice;

  /** Keep the activity, themed layout and deployment notice together for this document reader. */
  AccountDocuments(Activity activity, AccountLayout ui, String deploymentNotice) {
    this.activity = activity;
    this.ui = ui;
    this.deploymentNotice = deploymentNotice;
  }

  /** Resolve a document action label in the selected app language. */
  private String text(String key) { return AppLanguage.text(activity, key); }

  /** Present the available document types before opening a reader. */
  void open() {
    AccountLayout.Prompt menu = ui.prompt(text("account.terms_and_privacy"));
    choice(menu, "terms", "account.terms_of_use");
    choice(menu, "privacy", "account.privacy_notice");
    choice(menu, "license", "account.licenses_and_credits");
    menu.action(text("common.close"), AccountLayout.Action.SECONDARY, null);
    menu.show();
  }

  /** Bind a localized menu choice to the corresponding packaged document. */
  private void choice(AccountLayout.Prompt menu, String kind, String key) {
    String title = text(key);
    menu.choice(title, AccountLayout.Action.SECONDARY, () -> document(kind, title));
  }

  /** Append the deployment and optional-profile notices when displaying privacy information. */
  private void document(String kind, String title) {
    try {
      String contents;
      if (kind.equals("license")) {
        contents =
            IdentityService.asset(activity, "notice.txt")
                + "\n\n"
                + IdentityService.asset(activity, "license.txt")
                + "\n\n"
                + IdentityService.asset(activity, "icon-license.txt")
                + "\n\n" + IdentityService.asset(activity, "vendor/DOMPurify-LICENSE.txt");
      } else {
        contents = AppLanguage.document(activity, kind);
      }
      if (kind.equals("privacy"))
        contents +=
            "\n\n" + AppLanguage.document(activity, "optional-profile") + "\n\n" + text("retention.policy");
      if (kind.equals("privacy") && !deploymentNotice.isEmpty())
        contents += "\n\n" + deploymentNotice;
      AccountLayout.Prompt reader = ui.prompt(title);
      reader.description(contents);
      reader.action(text("common.close"), AccountLayout.Action.PRIMARY, null);
      reader.show();
    } catch (Exception e) {
      ui.message(text("account.could_not_load_the_document"));
    }
  }
}
