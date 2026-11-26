package app.anglers.journal;

import android.app.Activity;

/** Displays the account documents, packaged licenses and the deployment-specific privacy notice. */
final class AccountDocuments {
  private final Activity activity;
  private final AccountLayout ui;
  private final String deploymentNotice;

  AccountDocuments(Activity activity, AccountLayout ui, String deploymentNotice) {
    this.activity = activity;
    this.ui = ui;
    this.deploymentNotice = deploymentNotice;
  }

  private String text(String key) { return AppLanguage.text(activity, key); }

  void open() {
    AccountLayout.Prompt menu = ui.prompt(text("account.terms_and_privacy"));
    choice(menu, "terms", "account.terms_of_use");
    choice(menu, "privacy", "account.privacy_notice");
    choice(menu, "license", "account.licenses_and_credits");
    menu.action(text("common.close"), AccountLayout.Action.SECONDARY, null);
    menu.show();
  }

  private void choice(AccountLayout.Prompt menu, String kind, String key) {
    String title = text(key);
    menu.choice(title, AccountLayout.Action.SECONDARY, () -> document(kind, title));
  }

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
            "\n\n" + AppLanguage.document(activity, "optional-profile");
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
