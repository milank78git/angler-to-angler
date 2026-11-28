# Contributing

Branch from main and open a focused pull request. Describe the user-visible change, compatibility with existing journals, and what you tested. Keep source comments and developer documentation in English and user-facing text in Czech and English.

Run npm ci, npm test and the Android build as described in README.md. For changes to account identity or legal acknowledgements, test signed-out, returning, offline and changed-document paths. For regional rules, identify the authority, validity dates and supported water. Use synthetic test fixtures.

Contributions are licensed under Apache License 2.0 unless clearly marked with a compatible third-party license. Follow SECURITY.md for private security reports.

## Reproducing a behavior scenario

`npm test` runs the same scenario IDs for every entry in `app/src/main/assets/ui-locales.json`. Each language runs in a fresh process, using the packaged dictionary, the normal English fallback, a DOM and an isolated IndexedDB. A failure prints a command for that language, family and case. To run one family, use `node tests/scenarios/suite.mjs cs catch-entry`.

The navigation family checks the active route and all three tab histories, including an edit or save while a confirmation is pending. The bridge family checks three outstanding calls with independent service responses in each delivery order. Other families retry private messages using the same request ID, check the exact fields exported to Android, follow standalone help links, submit journal and community forms, reopen committed data, change public card privacy settings, select guide chapters and follow journeys starting at the actual application entry point. Language-independent IDs, family minimums and a digest guard against silently omitting cases in one language. Browser fixtures simulate native services. The field-integration job drives two installed Android clients against disposable Supabase. It submits and retries a purchase after the gateway discards a committed receipt, then reads the wallet, order and offer independently in PostgreSQL. It publishes and revokes a private journal catch through the WebView and checks the anonymous response at each step. These journeys run separately from the language count.

For public card race conditions, run `node tests/scenarios/suite.mjs cs public-reader-lifecycle`. The tests build the deployable Pages reader and control when network replies and response bodies finish. They check which card is visible, which link a report targets, and whether the page offers a retry.

## Reviewing functions and calls

Download `annotated-application-source` from the Android pilot workflow and open `source-review/index.html`. The generator checks that named runtime functions and helpers have a source comment. The listing covers first-party WebView scripts, web pages' scripts, native Java sources, the Play edge function and SQL migrations. Each call appears beside its source line with its enclosing function. Direct references to known project definitions link to their source where the target can be resolved. SQL annotations cover project routines inside migration function bodies. This preserves Liquibase checksums. The adjacent LCOV file and per-line hit indicators show what Node executed. The index also lists each function missed by Node with a link to its source. Android instrumentation runs separately. The profiles job publishes `database-function-coverage` with PostgreSQL call counts per installed signature from the disposable database. Inlined SQL may have no independent counter.

To generate the listing locally, create a Python virtual environment, install `scripts/source-review/requirements.txt`, and run `python scripts/source-review/build.py build/source-review`. Use `--coverage build/coverage/application.lcov` to include an existing Node coverage report. `python scripts/source-review/test_bridge.py` checks JavaScript bridge call names and arity against the native `@JavascriptInterface` declarations.
