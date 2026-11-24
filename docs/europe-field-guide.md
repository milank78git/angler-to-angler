# European field guide and market

The Android home screen opens the fish catalogue and the tip market. A water detail shows the number of currently available offers whose seller disclosed that registered water. An unavailable network count is displayed separately from zero. The catalogue, names, maps and help chapters work offline after installation.

## Identify a fish and choose the right jurisdiction

1. Search by scientific name, a published synonym, or a common name in the device language or English. A published market offer stores the scientific name and the water registry key. A private journal entry can keep a custom label.
2. Select a country, or explicitly request a location fix. Country polygons run on the device. At borders, at sea and for territories outside the packaged European window, select a country manually. The app remembers the country, never the catalogue lookup coordinates.
3. Open the species card. A recorded country occurrence indicates evidence of presence; records may include introduced species and historical specimens. The same country filter is available in the market editor. When editing an older offer, its existing species can be retained. A missing record is not a determination of absence. Choose All of Europe to see unassigned species.
4. On the card, choose the country where fishing will take place. Read each measurement, scope, season and source. Some limits are strict thresholds, maxima or combined bag limits. An entry may refer to one canton, basin, licence or year. Check the local permit and the original text. Separate articles can apply simultaneously.
5. After the source review date, the app displays a review notice and the link in place of the old values. An unverified combination displays the country source directory. Legal gaps never become a zero minimum or a permission to retain fish.

## Included data

| Input | Use | Update and attribution |
| --- | --- | --- |
| [RivFISH v1.1](https://doi.org/10.5281/zenodo.14509748) | Freshwater taxon list and unambiguous synonyms | Mameri and colleagues, CC BY 4.0. Archive checksum pinned. |
| [EEA European Red Lists](https://www.eea.europa.eu/en/datahub/datahubitem-view/202f3c2e-54a9-4ff4-a1da-ed7ca524f634) | European marine and freshwater inventories and historical assessment codes | European Environment Agency and contributing assessors, CC BY 4.0. Source table checksum pinned. The extraction year on each record is important. |
| [iNaturalist](https://api.inaturalist.org/v1/docs/) and [GBIF](https://techdocs.gbif.org/en/openapi/v1/occurrence) | Country-level evidence from geographically filtered CC0 records | Retain aggregate labels and country membership. No observation coordinates or observer identities are redistributed. The GBIF queries include georeferenced human/machine observations and preserved specimens. |
| [Wikidata](https://www.wikidata.org/wiki/Wikidata:Licensing) | Vernacular names matched by exact scientific name and species rank | CC0 labels. An English or scientific name is used where a local label is unavailable. |
| [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) | Offline 1:50m country polygons | Public domain, version 5.1.2. Lookups use simplified polygons. |
| Published national surveys and inventories | Extra occurrence evidence where global sources lack coverage | See the individual links in the packaged european checklists asset. Only factual species/country pairs are retained. The Czech supplement uses species-level entries in Table 4 of the Ministry of the Environment’s river assessment. |
| [FAOLEX](https://www.fao.org/faolex/en/) and domestic agencies, fishing authorities and laws | Country discovery, followed by scoped, source-reviewed facts | Link to the original document. Sources, review dates and exceptions are stored in the rule asset. |

Both import stages reconcile country memberships before writing the asset. For a taxon in the marine inventory alone, an aggregate record from an inland country needs corroboration from a national checklist. The raw GBIF tags remain available for provenance. Mixed freshwater and marine taxa retain their evidenced memberships. Caspian coastal countries are outside this inland filter.

The 51-jurisdiction directory includes transcontinental countries and Kosovo. The occurrence query window runs from 33° W to 70° E and 27° N to 83° N. It cannot represent every European island, offshore occurrence or historical taxonomic interpretation. The fishing-water registry currently uses the Czech pilot waters. Species availability and country coverage do not create new market waters. To add a water, register its jurisdiction, managing authority, official code and aliases both in the offline pack and the server registry.

## Maintain a release

- Weekly GitHub Actions checks the current published rule-source fingerprints and deadlines. A changed page, an inaccessible document or an expired review produces a visible action item. Sources that reject automated requests are marked for interactive review and retain individual deadlines. Reading a URL successfully is not a legal review.
- The monthly or manually dispatched candidate job retrieves the pinned taxonomic releases, current occurrence records and vernacular names into a fresh cache. It produces a candidate patch and a SQL seed as review artifacts. No automated job deploys rules or changes the pilot database.
- For a new release of RivFISH or the EEA inventory, compare the publisher's new version and checksum, accepted names, synonyms and licensing. Record the new source and update the pinned digest intentionally. Check the IUCN 2026 assessment separately from the older EEA historical records.
- For a changed law, open the official consolidated text and effective dates. Compare the jurisdiction, fish form or stock, territory, water class, recreational status, measurement convention, exceptions and bag limits with the previous entry. Have a reader familiar with that jurisdiction verify the interpretation. Retain existing reviews in git history.
- Update the minimum, maximum, exclusive threshold, closed period or retention-only period separately as applicable. If the effective conditions cannot be represented safely, leave the structured combination unverified and link the official text. Annual rules also carry an explicit end of validity. A future review deadline cannot extend them into another season. The source registry includes Vatican City with no confirmed angling rule. In San Marino the current entry concerns licensing, while other entries may concern only one lake or fish. Do not renew a deadline from an HTTP check.
- Run `python3 scripts/review-field-guide.py`, `python3 scripts/index-translations.py --check` and `npm test`. Compare `python3 scripts/review-field-guide.py --snapshot` with the existing fingerprints. Update fingerprints only after reviewing changes. Include new scientific names in a new database migration using `python3 scripts/market-species-seed.py`. Keep old identifiers and immutable purchases accessible when taxonomy changes. Run the SQL fixture, Android smoke tests and publish the assets together.

## Language and help

English source messages index the UTF-8 dictionaries. Android and the journal use the phone or Android per-app language, with an English fallback per missing message. Czech and English have authored text. Additional languages use offline-generated translation drafts with curated navigation labels in major languages. Technical, legal and fish names have separate sources. User input and the source law are never sent to a translation service.

Use `scripts/index-translations.py` after changing source strings, help or field hints. Preserve human-reviewed translations when rebuilding drafts. The M2M100 model and Apache-licensed Helsinki-NLP OPUS-MT en-mul model are build-time dependencies and are not shipped. Validate names, units, numbers, plurals, region/script variants and Android screen-reader labels with native speakers before claiming full localization for a language. The pack list does not cover every European regional language or dialect.

## Market statistics and privacy

The discovery endpoint filters registered waters before counting all available offers, distinct authors, historical purchases of those active offers and their buyer reviews. Counts are independent of the page cursor. Sold-out and withdrawn offers leave discovery. A buyer keeps the originally purchased text. The tip's score aggregates purchases across its versions. The author's score includes reviews on other tips. Both expose the number of contributors. Neither measure establishes a catch success rate.

Every journal destination has a contextual help chapter. The toolbar opens the chapter for the current screen. Each labelled field with a help button opens its own explanation and an optional link to the related chapter. The index searches all chapters. Closing help restores focus without discarding the draft. Native account and group screens open the same bundled guide. Replies and emoji retain their existing ownership and threading rules.
