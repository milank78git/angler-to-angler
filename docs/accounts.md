# Deploy accounts

The repository contains a mobile client and a PostgreSQL migration for Supabase Auth/PostgREST. A fresh unconfigured build displays the documents and keeps the journal locked. Each installation accepts one packaged issuer. Both standard and preview IDs use their own callback and isolated local storage.

1. Create an operator-owned Supabase project in the chosen EU region (or operate the compatible stack). Set up custom SMTP. Turn off anonymous sign-ins. Apply `supabase/migrations/202611230001_profiles.sql` with your migration role. Enable email sign-in and require email confirmation. Put `{{ .Token }}` in both signup confirmation and magic-link templates. Test delivery to an external mailbox.
2. Register OAuth web clients with Google and Meta. Configure the exact HTTPS callback displayed by Supabase in both provider consoles. Set the client IDs/secrets in the provider dashboard. Enable Facebook Login in live mode for users outside the development team and publish its required privacy and data-deletion URLs. Request only sign-in identity/email.
3. Allow the exact mobile redirects `app.anglers.journal://account/callback` and, for the preview project, `app.anglers.journal.preview://account/callback`. The native flow uses an external browser and a one-time PKCE S256 verifier. Use independent provider projects for test and production.
4. Provide the controller-approved deployment notice in both languages. Name the actual identity host, SMTP and logging processors, log and backup retention, and any transfers or safeguards. Complete processor agreements and publish reachable privacy and deletion information before public signup. Store only the public configuration in GitHub's **Actions variable** `ANGLER_ACCOUNT_CONFIG` or set `ANGLER_ACCOUNT_CONFIG_FILE` to a local JSON file when building. Gradle accepts the same file during asset generation. Never put service-role keys, provider secrets or SMTP credentials in either build.

```json
{"url":"https://YOUR-PROJECT.supabase.co","publishableKey":"sb_publishable_…","deploymentEn":"Operator-approved deployment details in English","deploymentCs":"Schválené údaje o nasazení v češtině"}
```

After the provider verifies the person, the client checks the profile through authenticated RPCs. A new profile needs a display name, an explicit terms acceptance and a separate privacy acknowledgement. The service stamps both revisions and the time. A document update requires a new immutable revision in the migration and client, replacing the text in the four bundled documents. Serve the same change to all languages. Preserve old text in Git and acceptance history in the database.

The phone keeps a verified profile identifier and timestamp for up to seven days of offline access. Bearer tokens stay in process memory only. Signing out locks this device and cancels local reminders. After the grace period the user must authenticate again. Earlier data on a shared phone are linked only by the initial user's explicit choice. Erasure of a hosted account does not remotely wipe an offline device.

## Controller procedures

Milan Kucera handles requests at milan.kucera78@gmail.com. Verify the requester's identity proportionately and never request their password or OTP. For access or portability provide their Auth identity, profile and acceptance history. Correct the verified user's display name on request. Delete the corresponding Auth user for closure. Foreign keys cascade deletion to profile and receipts. Explain local deletion and the actual backup retirement period. Document and answer rights requests within the applicable GDPR deadlines. Keep provider agreements, incident response and actual retention settings under operational review.

## Acceptance before release

Verify the consent pages before authentication, both unchecked boxes, first registration, returning user, cancelled provider login, email code, Google and Facebook redirects with real test identities, logout, document reacceptance, two-account journal isolation and offline expiry. CI exercises both social authorization requests and native callbacks, the PKCE exchange and email registration with a synthetic account service. External provider consoles and mail delivery require a configured deployment.
