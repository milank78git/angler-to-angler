# Deploy accounts

The repository contains a mobile client and a PostgreSQL migration for Supabase Auth/PostgREST. A fresh unconfigured build displays the documents and keeps the journal locked. Each installation accepts one packaged issuer. Both standard and preview IDs use their own callback and isolated local storage.

1. Create an operator-owned Supabase project in the chosen EU region (or operate the compatible stack). For a closed test the default mail service accepts project team addresses. Configure custom SMTP before inviting external users. Turn off anonymous sign-ins. Apply `supabase/migrations/20261123070056_profiles.sql` with your migration role. Enable email sign-in and require email confirmation. Set the minimum password length to at least 8. Install the confirmation, recovery and legacy magic-link templates described below. The angler opens confirmation or recovery on the requesting phone. Auth returns a short-lived code to Android and the app checks the verified email and retrieves the profile. Test delivery to an external mailbox.
2. Register OAuth web clients with Google and Meta. Configure the exact HTTPS callback displayed by Supabase in both provider consoles. Set the client IDs/secrets in the provider dashboard. Enable Facebook Login in live mode for users outside the development team and publish its required privacy and data-deletion URLs. Request only sign-in identity/email.
3. Allow the exact mobile redirects `app.anglers.journal://account/callback` and, for the preview project, `app.anglers.journal.preview://account/callback`. Set the standard URI as the Site URL. Enter each installed variant’s exact URI under Authentication → URL Configuration → Redirect URLs. Email confirmation, recovery and social sign-in use PKCE S256. The sign-in screen displays the social providers enabled in the public Auth settings. Google requests account selection in the system browser. Use independent provider projects for test and production.
4. Provide the controller-approved deployment notice in both languages. Name the actual identity host, SMTP and logging processors, log and backup retention, and any transfers or safeguards. Complete processor agreements and publish reachable privacy and deletion information before public signup. Store only the public configuration in GitHub's **Actions variable** `ANGLER_ACCOUNT_CONFIG` or set `ANGLER_ACCOUNT_CONFIG_FILE` to a local JSON file when building. Gradle accepts the same file during asset generation. Never put service-role keys, provider secrets or SMTP credentials in either build.

```json
{"url":"https://YOUR-PROJECT.supabase.co","publishableKey":"sb_publishable_…","deploymentEn":"Operator-approved deployment details in English","deploymentCs":"Schválené údaje o nasazení v češtině"}
```

After the provider verifies the person, the client checks the profile through authenticated RPCs. A new profile needs a display name, an explicit terms acceptance and a separate privacy acknowledgement. The service stamps both revisions and the time. A document update requires a new immutable revision in the migration and client, replacing the text in the four bundled documents. Serve the same change to all languages. Preserve old text in Git and acceptance history in the database.

The phone keeps a verified profile identifier and timestamp for up to seven days of offline access. On secured devices Android Keystore gates the encrypted refresh token with system authentication. Passwords and access tokens are never written to application storage. An unlocked session locks on screen-off, process death or a minute in the background. Android 10 and later offer system biometrics or device credentials. Older devices use the system screen lock. Without a secure screen lock the next cold start requires online sign-in. Signing out locks this device and cancels local reminders. After the grace period the user must authenticate again. Earlier data on a shared phone are linked only by the initial user's explicit choice. Erasure of a hosted account does not remotely wipe an offline device.

## Transactional email

With an authenticated SMTP sender, open **Authentication → Email Templates**. Paste each HTML file and its matching subject below. Confirmation, recovery and older magic-link messages select the language recorded in the Auth user's metadata at registration. Existing accounts without a language receive Czech. Disable link tracking at the mail provider so the verification URL reaches the requesting device intact.

| Supabase template | Body | Subject |
| --- | --- | --- |
| Confirm signup | [confirmation.html](../supabase/templates/confirmation.html) | `{{ if eq .Data.locale "en" }}Confirm your email · Angler to Angler{{ else }}Potvrď svůj e-mail · Rybáři sobě{{ end }}` |
| Reset password | [recovery.html](../supabase/templates/recovery.html) | `{{ if eq .Data.locale "en" }}Set your password · Angler to Angler{{ else }}Nastavení hesla · Rybáři sobě{{ end }}` |
| Magic link | [magic_link.html](../supabase/templates/magic_link.html) | `{{ if eq .Data.locale "en" }}Sign in to your journal · Angler to Angler{{ else }}Přihlášení do deníku · Rybáři sobě{{ end }}` |

On an existing email-link account, choose **Set or reset password** once and use the email already registered. Recovery updates the same Auth user. Profile, groups and local journal retain the same identifier. A new device still needs online sign-in before it can use its own system screen lock. Local journal files are specific to each installation.

## Controller procedures

Milan Kucera handles requests at milan.kucera78@gmail.com. Verify the requester's identity proportionately and never request their password or OTP. For access or portability provide their Auth identity, profile and acceptance history. Correct the verified user's display name on request. Delete the corresponding Auth user for closure. Foreign keys cascade deletion to profile and receipts. Explain local deletion and the actual backup retirement period. Document and answer rights requests within the applicable GDPR deadlines. Keep provider agreements, incident response and actual retention settings under operational review.

## Acceptance before release

Verify the consent pages before authentication, both unchecked boxes, first registration, returning user, cancelled provider login, email link on the requesting phone, Google and Facebook redirects with real test identities, logout, document reacceptance, two-account journal isolation and offline expiry. CI exercises both social authorization requests and native callbacks, the PKCE exchange and email registration with a synthetic account service. External provider consoles and mail delivery require a configured deployment.

## Private fishing groups

Apply the `private_fishing_groups` migration after `profiles`. Group management requires a current verified profile, a confirmed email and an online access token. Unlocking restores the session across restarts. The app refreshes access tokens on demand. A revoked refresh credential requires online sign-in. The existing offline journal lease remains independent.

The service stores a group name, owner and membership identifiers. The listing returns only the caller’s group names, IDs, member counts and owner/member role. Only an owner may issue a 24-hour, single-use code. Issuing another code revokes its predecessor. The database retains only hashes. Leaving removes the membership. Dissolving a group removes all memberships and the invitation. Account erasure removes that account’s memberships and groups it owns. Include these records when handling a profile access or erasure request. The phone keeps group responses in memory. Journal contents are never uploaded by these functions.

Apply the `private_group_tips` migration for direct trip tips. The service stores the author, group, posting time and exact previewed text. The author chooses the group for each post. Current members can read the group’s tips, newest first. Leaving removes the member’s posts, dissolving a group removes its feed, and account erasure removes the author’s posts. Include authored group tips in an account export.

## Optional profile and catch review

Apply the `angler_profile_cards` migration after private groups. Existing accounts start with a blank, private card. Verified anglers can publish or withdraw their own card. The directory uses cursor pagination and never lists private cards. A visitor sees only groups shared with the card owner. A photo replaces its predecessor and the editor rejects stale changes from a second device.

The camera returns a fresh image to the app, which requests a location fix. The app accepts a fix within two minutes and at most 100 m reported accuracy. The trip date must match the capture date in the trip time zone. The owner can submit within seven days, including after an offline trip. The review copy contains resized pixels, species, time, water name, and coordinates rounded to 0.01 degrees. This is device evidence and visual review, without hardware attestation. The journal and gallery remain available when the camera or position is unavailable.

To appoint a reviewer, the operator looks up the intended registered account in Supabase Auth. Run the following parameterized SQL as the migration role, binding the verified UUID to `$1`:

```sql
insert into angler_private.catch_reviewers(user_id) values ($1) on conflict do nothing;
```

Remove that row to revoke access. Reviewers use **Profile → My submitted catch photos → Review submitted photos**. Check whether the reported water matches the approximate location, the fish is visible, and the image supports a ruler reading or a defensible estimate against a known-size reference. Enter the length and distinguish measured from estimated. Select **Insufficient evidence** for a photo of a photo or when the location or scale cannot support the submission. This outcome leaves the catch in its owner’s journal. Reviewers cannot decide their own submissions. Concurrent decisions count once. Exact duplicate pixel payloads cannot count twice.

The profile counts **Photo-documented catches**. A ruler reading and an estimate each count once. The review describes the submitted evidence. Capture time and location alone cannot establish who caught the fish. The decision clears the hosted image, water and coordinates. The owner can remove the hosted record separately from a local trip, before or after review. Account erasure cascades to the owner's submissions and reviewer assignment. Include the card and owned review records in a data export. Backup retention follows the deployment notice.

## Water discussions

Apply the `water_discussions` migration. Each enabled water has a stable country-prefixed catalog ID and local time zone. Signed-in anglers with current verified profiles can read the feed. A question and its replies belong to one water. Posts expose the display name, text, publication time and an optional trip date for replies. Only the question author can mark another angler's reply as helpful.

The pilot operator reviews flags in `angler_discussions.reports` joined to `angler_discussions.posts` on `posts.id = reports.post_id`. The operator can dismiss a flag by deleting the reviewed report, or withdraw the reported content using the database operator connection and `select angler_discussions.remove_content($1, $2, null)` with its water key and post UUID. Mobile users have no access to that operator function. Apply the `forum_reply_context` migration to protect the topic and its addressed replies. A participant may withdraw only their own text that has never received a public text reply. An emoji or private message does not lock a forum post. Operator removal clears only the selected text, trip date and flags. Linked replies survive and their quotation becomes a removal notice. Profile erasure removes that author’s text and identity while other participants retain their contributions. The service retains the withdrawn post’s identifier and ownership until account erasure to prevent an old request from republishing it. Include owned posts and submitted reports when fulfilling an account export.

## Private messages

Apply the `private_messages` migration after water discussions. The first message is addressed to the author of a visible question. Verified participants can continue from their inbox after the original question is withdrawn. The service resolves the recipient and enforces one conversation per pair across all waters. A block by either party stops new messages and leaves the existing history readable. Unblocking removes only the caller's own block.

Apply the `message_reactions` migration to enable one optional emoji per participant per message. Each participant can change only their own reaction. During a block they can still remove it. Both reactions are visible only in that conversation and are erased with it. Include reactions with message exports.

The pilot operator can review reported messages with the following query. A report identifies only the selected incoming message. Use the position to locate the reported entry when handling the request. The mobile roles cannot query these tables. Include the user's conversations when fulfilling an account access request. Deleting either participant's account removes the thread, its messages and report flags.

```sql
select position, body, posted_at, reported_at
from angler_messages.entries
where reported_at is not null
order by reported_at;
```

## Group catch of the week

Apply the `group_catch_week` migration. Round boundaries are Monday at 00:00 in Europe/Prague. The journal trip date determines eligibility, including for a manually recorded catch. Only catches from the current week through today can enter. Each photo nomination requires a group and a confirmation. The board is a popularity vote and does not use catch evidence or measured length. Each member can vote for any number of different catches, once per other angler's entry. Totals and competition ranks update when a vote, entry or membership is removed. A closed round accepts withdrawals of existing votes and entries.

All board requests check current group membership. The server stores an opaque entry ID, source catch ID, owner, group, date, species and a reduced WebP copy. Only the display name, species, date, reduced pixels, totals, rank and caller-specific flags appear on the board. Withdrawal erases the copy, species, reports and votes. The service retains a receipt containing the entry and catch IDs, group, owner and catch date until membership ends or the group or account is erased. Include owned entries and votes in an export.

To review a reported photo, use the operator database connection. Bind the reviewed entry UUID as `$1`. Only this connection can pause or reinstate an entry. While held, the author can see its review status and withdraw it. Other members cannot see it or vote for it. Reinstatement recalculates rank using the retained votes.

```sql
select e.group_id, e.id, e.species, e.photo, count(*) as reports
from angler_weekly.reports r join angler_weekly.entries e on e.id = r.entry_id
group by e.id;

update angler_weekly.entries set held = true where id = $1 and photo is not null;
-- After review, use held = false to reinstate the entry, or remove its shared copy.
select angler_weekly.remove_entry(group_id, id, null) from angler_weekly.entries where id = $1;
```

## Water activity

A trip is private until its owner confirms a contribution. Changes to the local journal do not automatically replace the snapshot. An owner can update it explicitly, withdraw it from their profile, or erase the account. Only the private owner receipt includes the journal identifier. The aggregate API requires a verified pilot profile and exposes neither author identifiers nor individual reports.

A period covers one entire catalog water for one Prague calendar month, first available on day eight of the next month. Each published group needs at least ten trips and five distinct accounts. The server selects the finest safe partition for the entire water/month before applying any filter. It prefers target × method, then target, then method, and finally the whole water. A split is allowed only when every nonempty group in that partition meets both minima. This prevents recovering a suppressed group by subtracting same-period filter totals. Historical totals can change when owners contribute, update or withdraw. Successful trips count all trips with at least one recorded fish, irrespective of target species.
