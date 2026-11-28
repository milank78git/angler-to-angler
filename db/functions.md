# Database function index

Active signatures in Liquibase deployment order. Each link opens the effective definition. Renamed functions also link to the migration that assigned their current name.

| Function signature | Definition | Rename |
| --- | --- | --- |
| `angler_activity.archive_parking()` | [20261126060000](../supabase/migrations/20261126060000_community_protection.sql#L112) |  |
| `angler_activity.change(uuid, integer, text, date, text, angler_activity.method, integer)` | [20261126140000](../supabase/migrations/20261126140000_catalogue_activity_targets.sql#L22) |  |
| `angler_activity.clear_species()` | [20261124122648](../supabase/migrations/20261124122648_volunteered_species_counts.sql#L3) |  |
| `angler_activity.mine(bigint)` | [20261123171108](../supabase/migrations/20261123171108_water_activity.sql#L69) |  |
| `angler_activity.parking_feedback(uuid, boolean, integer, text, bigint)` | [20261125045854](../supabase/migrations/20261125045854_community_parking.sql#L83) |  |
| `angler_activity.parking_list(text)` | [20261125153400](../supabase/migrations/20261125153400_parking_edit_ownership.sql#L6) |  |
| `angler_activity.parking_note_items(uuid, bigint)` | [20261126060000](../supabase/migrations/20261126060000_community_protection.sql#L133) |  |
| `angler_activity.parking_save(text, uuid, integer, numeric, numeric, text)` | [20261125153400](../supabase/migrations/20261125153400_parking_edit_ownership.sql#L20) |  |
| `angler_activity.parking_waters()` | [20261125045854](../supabase/migrations/20261125045854_community_parking.sql#L32) |  |
| `angler_activity.rating(text, integer, boolean)` | [20261124122638](../supabase/migrations/20261124122638_water_reviews_and_visit_statistics.sql#L11) |  |
| `angler_activity.receipt(angler_activity.trips)` | [20261123171108](../supabase/migrations/20261123171108_water_activity.sql#L26) |  |
| `angler_activity.restore_parking(uuid, integer, integer)` | [20261126060000](../supabase/migrations/20261126060000_community_protection.sql#L122) |  |
| `angler_activity.reviewed_contributor(uuid)` | [20261126021000](../supabase/migrations/20261126021000_audit_publication_controls.sql#L52) |  |
| `angler_activity.species_share(uuid, integer, bigint, jsonb)` | [20261124122648](../supabase/migrations/20261124122648_volunteered_species_counts.sql#L13) |  |
| `angler_activity.state(uuid)` | [20261123171108](../supabase/migrations/20261123171108_water_activity.sql#L33) |  |
| `angler_activity.summary(text, date, text, angler_activity.method)` | [20261126140000](../supabase/migrations/20261126140000_catalogue_activity_targets.sql#L49) |  |
| `angler_activity.target_key(text)` | [20261126140000](../supabase/migrations/20261126140000_catalogue_activity_targets.sql#L7) |  |
| `angler_activity.top_species()` | [20261126021000](../supabase/migrations/20261126021000_audit_publication_controls.sql#L100) |  |
| `angler_activity.top_waters()` | [20261126021000](../supabase/migrations/20261126021000_audit_publication_controls.sql#L90) |  |
| `angler_atlas.install(jsonb, text)` | [20261124060000](../supabase/migrations/20261124060000_water_directory.sql#L17) |  |
| `angler_atlas.refresh()` | [20261124060300](../supabase/migrations/20261124060300_water_directory_schedule.sql#L4) |  |
| `angler_commerce.credit_receipt(uuid, text, angler_commerce.lots, jsonb)` | [20261126080000](../supabase/migrations/20261126080000_age_and_guardians.sql#L422) |  |
| `angler_commerce.discover(text, bigint, boolean)` | [20261125165309](../supabase/migrations/20261125165309_market_purchase_funding.sql#L112) |  |
| `angler_commerce.enroll_offer(uuid, angler_market.offers, jsonb)` | [20261125165309](../supabase/migrations/20261125165309_market_purchase_funding.sql#L157) |  |
| `angler_commerce.keep_environment()` | [20261125075304](../supabase/migrations/20261125075304_play_market_settlement.sql#L254) |  |
| `angler_commerce.market(text, jsonb)` | [20261125165309](../supabase/migrations/20261125165309_market_purchase_funding.sql#L206) |  |
| `angler_commerce.publish_offer(jsonb)` | [20261125165309](../supabase/migrations/20261125165309_market_purchase_funding.sql#L133) |  |
| `angler_commerce.purchase_offer(uuid, angler_market.offers, jsonb)` | [20261125165309](../supabase/migrations/20261125165309_market_purchase_funding.sql#L166) |  |
| `angler_commerce.receipt(text, jsonb)` | [20261126021000](../supabase/migrations/20261126021000_audit_publication_controls.sql#L164) |  |
| `angler_commerce.request_payout(uuid)` | [20261125165309](../supabase/migrations/20261125165309_market_purchase_funding.sql#L145) |  |
| `angler_commerce.settle_receipt(angler_commerce.lots, jsonb)` | [20261125175002](../supabase/migrations/20261125175002_receipt_operations.sql#L18) |  |
| `angler_commerce.void_receipt(text, angler_commerce.lots)` | [20261125175002](../supabase/migrations/20261125175002_receipt_operations.sql#L1) |  |
| `angler_commerce.wallet(uuid)` | [20261125075304](../supabase/migrations/20261125075304_play_market_settlement.sql#L88) |  |
| `angler_commerce.welcome()` | [20261125075304](../supabase/migrations/20261125075304_play_market_settlement.sql#L75) |  |
| `angler_discussions.card(angler_discussions.posts, text, uuid)` | [20261123161727](../supabase/migrations/20261123161727_forum_reply_context.sql#L77) |  |
| `angler_discussions.erase_profile_posts()` | [20261123161727](../supabase/migrations/20261123161727_forum_reply_context.sql#L67) |  |
| `angler_discussions.has_replies(uuid)` | [20261127032314](../supabase/migrations/20261127032314_journal_community_controls.sql#L2) |  |
| `angler_discussions.mark_helpful(text, uuid, boolean)` | [20261123153421](../supabase/migrations/20261123153421_water_discussions.sql#L119) |  |
| `angler_discussions.page(text, uuid, bigint)` | [20261123161727](../supabase/migrations/20261123161727_forum_reply_context.sql#L89) |  |
| `angler_discussions.post(text, uuid, uuid, text, date)` | [20261123161727](../supabase/migrations/20261123161727_forum_reply_context.sql#L42) |  |
| `angler_discussions.remove_content(text, uuid, uuid)` | [20261123161727](../supabase/migrations/20261123161727_forum_reply_context.sql#L51) |  |
| `angler_discussions.report(text, uuid)` | [20261123153421](../supabase/migrations/20261123153421_water_discussions.sql#L131) |  |
| `angler_discussions.withdraw(text, uuid)` | [20261123153421](../supabase/migrations/20261123153421_water_discussions.sql#L110) |  |
| `angler_discussions.write_post(text, uuid, uuid, uuid, text, date)` | [20261123161727](../supabase/migrations/20261123161727_forum_reply_context.sql#L17) |  |
| `angler_groups_private.card(uuid)` | [20261124000054](../supabase/migrations/20261124000054_purchased_tip_ratings.sql#L94) |  |
| `angler_groups_private.create_group(uuid, text)` | [20261126080000](../supabase/migrations/20261126080000_age_and_guardians.sql#L247) |  |
| `angler_groups_private.decide_evidence(uuid, uuid, text, integer)` | [20261123112814](../supabase/migrations/20261123112814_angler_profile_cards.sql#L110) |  |
| `angler_groups_private.directory(uuid)` | [20261123112814](../supabase/migrations/20261123112814_angler_profile_cards.sql#L162) |  |
| `angler_groups_private.dissolve(uuid)` | [20261123110524](../supabase/migrations/20261123110524_private_fishing_groups.sql#L114) |  |
| `angler_groups_private.evidence_list(timestamp with time zone, uuid, uuid)` | [20261123112814](../supabase/migrations/20261123112814_angler_profile_cards.sql#L71) |  |
| `angler_groups_private.invite(uuid)` | [20261123110524](../supabase/migrations/20261123110524_private_fishing_groups.sql#L69) |  |
| `angler_groups_private.join_group(uuid)` | [20261127121000](../supabase/migrations/20261127121000_review_journal_and_community.sql#L258) |  |
| `angler_groups_private.leave_group(uuid)` | [20261126080000](../supabase/migrations/20261126080000_age_and_guardians.sql#L238) |  |
| `angler_groups_private.licence_details(jsonb)` | [20261126150300](../supabase/migrations/20261126150300_remove_stored_age.sql#L2) |  |
| `angler_groups_private.list_groups()` | [20261126080000](../supabase/migrations/20261126080000_age_and_guardians.sql#L198) |  |
| `angler_groups_private.list_tips(uuid, bigint)` | [20261127032314](../supabase/migrations/20261127032314_journal_community_controls.sql#L18) |  |
| `angler_groups_private.my_details(jsonb)` | [20261126080000](../supabase/migrations/20261126080000_age_and_guardians.sql#L409) |  |
| `angler_groups_private.post_tip(uuid, uuid, text)` | [20261126080000](../supabase/migrations/20261126080000_age_and_guardians.sql#L264) |  |
| `angler_groups_private.remove_evidence(uuid)` | [20261123112814](../supabase/migrations/20261123112814_angler_profile_cards.sql#L125) |  |
| `angler_groups_private.remove_shared_catch(bigint)` | [20261126150100](../supabase/migrations/20261126150100_group_catch_moderation.sql#L29) |  |
| `angler_groups_private.require_group_access(uuid, uuid)` | [20261123142819](../supabase/migrations/20261123142819_private_group_tips.sql#L21) |  |
| `angler_groups_private.review_actor()` | [20261123112814](../supabase/migrations/20261123112814_angler_profile_cards.sql#L87) |  |
| `angler_groups_private.review_next()` | [20261123112814](../supabase/migrations/20261123112814_angler_profile_cards.sql#L98) |  |
| `angler_groups_private.save_card(integer, text, text, text, integer, text, boolean)` | [20261123112814](../supabase/migrations/20261123112814_angler_profile_cards.sql#L181) |  |
| `angler_groups_private.subject()` | [20261126150200](../supabase/migrations/20261126150200_birth_date_corrections.sql#L16) |  |
| `angler_groups_private.submit_evidence(uuid, text, text, date, text, bigint, bigint, integer, integer, integer, text)` | [20261123112814](../supabase/migrations/20261123112814_angler_profile_cards.sql#L39) |  |
| `angler_market.activate()` | [20261123232227](../supabase/migrations/20261123232227_test_tip_market.sql#L87) |  |
| `angler_market.archive_seller_tips()` | [20261125154111](../supabase/migrations/20261125154111_purchased_tip_retention.sql#L24) |  |
| `angler_market.author_rating(uuid)` | [20261125165309](../supabase/migrations/20261125165309_market_purchase_funding.sql#L52) |  |
| `angler_market.author_rating(uuid, boolean)` | [20261125165309](../supabase/migrations/20261125165309_market_purchase_funding.sql#L38) |  |
| `angler_market.buy(uuid, integer, integer)` | [20261125075304](../supabase/migrations/20261125075304_play_market_settlement.sql#L103) |  |
| `angler_market.buy_pilot(uuid, integer, integer)` | [20261123232227](../supabase/migrations/20261123232227_test_tip_market.sql#L136) | [20261125075304](../supabase/migrations/20261125075304_play_market_settlement.sql#L101) |
| `angler_market.clear_erased_rating()` | [20261124000054](../supabase/migrations/20261124000054_purchased_tip_ratings.sql#L14) |  |
| `angler_market.detail(uuid)` | [20261125165309](../supabase/migrations/20261125165309_market_purchase_funding.sql#L81) |  |
| `angler_market.discover(text, bigint)` | [20261125075304](../supabase/migrations/20261125075304_play_market_settlement.sql#L135) |  |
| `angler_market.list_items(text, bigint)` | [20261123232227](../supabase/migrations/20261123232227_test_tip_market.sql#L54) |  |
| `angler_market.preview(angler_market.offers, angler_market.versions)` | [20261125165309](../supabase/migrations/20261125165309_market_purchase_funding.sql#L99) |  |
| `angler_market.prune_archived_tip(uuid)` | [20261125154111](../supabase/migrations/20261125154111_purchased_tip_retention.sql#L6) |  |
| `angler_market.publish(uuid, integer, jsonb)` | [20261124004714](../supabase/migrations/20261124004714_european_market_directory.sql#L2030) |  |
| `angler_market.publish_validated_draft(uuid, integer, jsonb)` | [20261126021000](../supabase/migrations/20261126021000_audit_publication_controls.sql#L1) |  |
| `angler_market.rate(uuid, integer, integer, integer)` | [20261125165309](../supabase/migrations/20261125165309_market_purchase_funding.sql#L59) |  |
| `angler_market.release_archived_tip()` | [20261125154111](../supabase/migrations/20261125154111_purchased_tip_retention.sql#L41) |  |
| `angler_market.stamp_rating()` | [20261127032314](../supabase/migrations/20261127032314_journal_community_controls.sql#L269) |  |
| `angler_market.withdraw(uuid)` | [20261123232227](../supabase/migrations/20261123232227_test_tip_market.sql#L154) |  |
| `angler_messages.history(uuid, uuid, bigint)` | [20261123160129](../supabase/migrations/20261123160129_message_reactions.sql#L67) |  |
| `angler_messages.inbox(bigint)` | [20261127032314](../supabase/migrations/20261127032314_journal_community_controls.sql#L228) |  |
| `angler_messages.peer(uuid, uuid, uuid)` | [20261126080000](../supabase/migrations/20261126080000_age_and_guardians.sql#L442) |  |
| `angler_messages.react(uuid, bigint, text)` | [20261123160129](../supabase/migrations/20261123160129_message_reactions.sql#L41) |  |
| `angler_messages.report(uuid, bigint)` | [20261123155308](../supabase/migrations/20261123155308_private_messages.sql#L143) |  |
| `angler_messages.send(uuid, uuid, uuid, text)` | [20261123155308](../supabase/migrations/20261123155308_private_messages.sql#L98) |  |
| `angler_messages.set_block(uuid, boolean)` | [20261123155308](../supabase/migrations/20261123155308_private_messages.sql#L130) |  |
| `angler_messages.single_emoji(text)` | [20261123160129](../supabase/migrations/20261123160129_message_reactions.sql#L3) |  |
| `angler_private.age_years(date)` | [20261126080000](../supabase/migrations/20261126080000_age_and_guardians.sql#L3) |  |
| `angler_private.apply_birth_date_change()` | [20261128030000](../supabase/migrations/20261128030000_age_correction_journal_epoch.sql#L1) |  |
| `angler_private.check_nickname_scripts()` | [20261127134328](../supabase/migrations/20261127134328_distinguish_mixed_script_nicknames.sql#L1) |  |
| `angler_private.correct_birth_date(uuid, date, date)` | [20261126150200](../supabase/migrations/20261126150200_birth_date_corrections.sql#L77) |  |
| `angler_private.document_revision()` | [20261127121000](../supabase/migrations/20261127121000_review_journal_and_community.sql#L319) |  |
| `angler_private.group_subject(uuid, text, boolean)` | [20261126080000](../supabase/migrations/20261126080000_age_and_guardians.sql#L103) |  |
| `angler_private.limit_write()` | [20261126060000](../supabase/migrations/20261126060000_community_protection.sql#L10) |  |
| `angler_private.nickname_key(text)` | [20261126045000](../supabase/migrations/20261126045000_nickname_identity.sql#L12) |  |
| `angler_private.verified_subject()` | [20261126150200](../supabase/migrations/20261126150200_birth_date_corrections.sql#L3) |  |
| `angler_private.withdraw_child_shares()` | [20261126080000](../supabase/migrations/20261126080000_age_and_guardians.sql#L178) |  |
| `angler_public_cards.mine(bigint)` | [20261123180057](../supabase/migrations/20261123180057_public_catch_cards.sql#L91) |  |
| `angler_public_cards.options(uuid, text)` | [20261123180057](../supabase/migrations/20261123180057_public_catch_cards.sql#L30) |  |
| `angler_public_cards.owner_item(uuid, jsonb)` | [20261125154159](../supabase/migrations/20261125154159_public_card_reader.sql#L10) |  |
| `angler_public_cards.publish(uuid, uuid, jsonb, text, text)` | [20261123180057](../supabase/migrations/20261123180057_public_catch_cards.sql#L45) |  |
| `angler_public_cards.read_link(uuid)` | [20261123180057](../supabase/migrations/20261123180057_public_catch_cards.sql#L113) |  |
| `angler_public_cards.withdraw(uuid)` | [20261123180057](../supabase/migrations/20261123180057_public_catch_cards.sql#L102) |  |
| `angler_sync.attach_photos(uuid, jsonb)` | [20261127121000](../supabase/migrations/20261127121000_review_journal_and_community.sql#L57) |  |
| `angler_sync.canonical_json(jsonb)` | [20261127100000](../supabase/migrations/20261127100000_private_photo_retention.sql#L151) |  |
| `angler_sync.chunk_usage()` | [20261126060300](../supabase/migrations/20261126060300_journal_object_storage.sql#L24) |  |
| `angler_sync.convert_trip(uuid, text, timestamp with time zone)` | [20261127100000](../supabase/migrations/20261127100000_private_photo_retention.sql#L160) |  |
| `angler_sync.document_json(uuid, text[])` | [20261127100000](../supabase/migrations/20261127100000_private_photo_retention.sql#L144) |  |
| `angler_sync.journal(text, jsonb)` | [20261127121000](../supabase/migrations/20261127121000_review_journal_and_community.sql#L13) |  |
| `angler_sync.journal_v1(text, jsonb)` | [20261127032314](../supabase/migrations/20261127032314_journal_community_controls.sql#L180) | [20261127100000](../supabase/migrations/20261127100000_private_photo_retention.sql#L235) |
| `angler_sync.list_documents(uuid, jsonb)` | [20261125175001](../supabase/migrations/20261125175001_journal_operations.sql#L1) |  |
| `angler_sync.maintain()` | [20261126181000](../supabase/migrations/20261126181000_separate_journal_storage.sql#L2) |  |
| `angler_sync.maintain_photos()` | [20261127121000](../supabase/migrations/20261127121000_review_journal_and_community.sql#L187) |  |
| `angler_sync.maintain_storage()` | [20261126181000](../supabase/migrations/20261126181000_separate_journal_storage.sql#L29) |  |
| `angler_sync.missing_chunks(uuid, jsonb)` | [20261125175001](../supabase/migrations/20261125175001_journal_operations.sql#L12) |  |
| `angler_sync.photo_operation(uuid, text, jsonb)` | [20261127121000](../supabase/migrations/20261127121000_review_journal_and_community.sql#L119) |  |
| `angler_sync.photo_quota()` | [20261127100000](../supabase/migrations/20261127100000_private_photo_retention.sql#L30) |  |
| `angler_sync.photo_storage(text, uuid, bytea, integer, integer)` | [20261127121000](../supabase/migrations/20261127121000_review_journal_and_community.sql#L92) |  |
| `angler_sync.put_chunk(uuid, jsonb)` | [20261126060300](../supabase/migrations/20261126060300_journal_object_storage.sql#L66) |  |
| `angler_sync.read_chunk(uuid, text)` | [20261126060300](../supabase/migrations/20261126060300_journal_object_storage.sql#L54) |  |
| `angler_sync.save_document(uuid, jsonb)` | [20261126060300](../supabase/migrations/20261126060300_journal_object_storage.sql#L130) |  |
| `angler_sync.storage_request(text, uuid, text)` | [20261126060300](../supabase/migrations/20261126060300_journal_object_storage.sql#L40) |  |
| `angler_weekly.board(uuid, date, integer, text)` | [20261127032314](../supabase/migrations/20261127032314_journal_community_controls.sql#L67) |  |
| `angler_weekly.enter(uuid, uuid, uuid, date, text, text)` | [20261126080000](../supabase/migrations/20261126080000_age_and_guardians.sql#L306) |  |
| `angler_weekly.monday(date)` | [20261123163226](../supabase/migrations/20261123163226_group_catch_week.sql#L45) |  |
| `angler_weekly.monthly(uuid, boolean)` | [20261124122642](../supabase/migrations/20261124122642_optional_group_monthly_challenge.sql#L13) |  |
| `angler_weekly.remove_entry(uuid, uuid, uuid)` | [20261123163226](../supabase/migrations/20261123163226_group_catch_week.sql#L111) |  |
| `angler_weekly.report(uuid, uuid)` | [20261126080000](../supabase/migrations/20261126080000_age_and_guardians.sql#L386) |  |
| `angler_weekly.vote(uuid, uuid, boolean)` | [20261126080000](../supabase/migrations/20261126080000_age_and_guardians.sql#L363) |  |
| `angler_weekly.webp(bytea)` | [20261123163226](../supabase/migrations/20261123163226_group_catch_week.sql#L50) |  |
| `angler_weekly.withdraw(uuid, uuid)` | [20261127032314](../supabase/migrations/20261127032314_journal_community_controls.sql#L100) |  |
| `public.angler_accept(text, text, text)` | [20261126060200](../supabase/migrations/20261126060200_account_revision.sql#L10) |  |
| `public.angler_activity_change(uuid, integer, text, date, text, text, integer)` | [20261126140000](../supabase/migrations/20261126140000_catalogue_activity_targets.sql#L78) |  |
| `public.angler_activity_mine(bigint)` | [20261123171108](../supabase/migrations/20261123171108_water_activity.sql#L119) |  |
| `public.angler_activity_state(uuid)` | [20261123171108](../supabase/migrations/20261123171108_water_activity.sql#L111) |  |
| `public.angler_activity_summary(text, date, text, text)` | [20261126140000](../supabase/migrations/20261126140000_catalogue_activity_targets.sql#L84) |  |
| `public.angler_card(uuid)` | [20261123112814](../supabase/migrations/20261123112814_angler_profile_cards.sql#L204) |  |
| `public.angler_commerce(text, jsonb)` | [20261125075304](../supabase/migrations/20261125075304_play_market_settlement.sql#L195) |  |
| `public.angler_community_signal(uuid)` | [20261127121000](../supabase/migrations/20261127121000_review_journal_and_community.sql#L367) |  |
| `public.angler_directory(uuid)` | [20261123112814](../supabase/migrations/20261123112814_angler_profile_cards.sql#L206) |  |
| `public.angler_discussion_helpful(text, uuid, boolean)` | [20261123153421](../supabase/migrations/20261123153421_water_discussions.sql#L149) |  |
| `public.angler_discussion_post(text, uuid, uuid, text, date)` | [20261123153421](../supabase/migrations/20261123153421_water_discussions.sql#L145) |  |
| `public.angler_discussion_reply(text, uuid, uuid, uuid, text, date)` | [20261123161727](../supabase/migrations/20261123161727_forum_reply_context.sql#L44) |  |
| `public.angler_discussion_report(text, uuid)` | [20261123153421](../supabase/migrations/20261123153421_water_discussions.sql#L151) |  |
| `public.angler_discussion_withdraw(text, uuid)` | [20261123153421](../supabase/migrations/20261123153421_water_discussions.sql#L147) |  |
| `public.angler_end_post_watch(uuid)` | [20261124101500](../supabase/migrations/20261124101500_post_notifications.sql#L41) |  |
| `public.angler_evidence_decide(uuid, uuid, text, integer)` | [20261123112814](../supabase/migrations/20261123112814_angler_profile_cards.sql#L233) |  |
| `public.angler_evidence_list(timestamp with time zone, uuid, uuid)` | [20261123112814](../supabase/migrations/20261123112814_angler_profile_cards.sql#L223) |  |
| `public.angler_evidence_remove(uuid)` | [20261123112814](../supabase/migrations/20261123112814_angler_profile_cards.sql#L238) |  |
| `public.angler_evidence_review()` | [20261123112814](../supabase/migrations/20261123112814_angler_profile_cards.sql#L228) |  |
| `public.angler_evidence_submit(uuid, text, text, date, text, bigint, bigint, integer, integer, integer, text)` | [20261123112814](../supabase/migrations/20261123112814_angler_profile_cards.sql#L218) |  |
| `public.angler_family_permission(uuid, uuid, text, boolean)` | [20261126080000](../supabase/migrations/20261126080000_age_and_guardians.sql#L132) |  |
| `public.angler_family_permissions()` | [20261126080000](../supabase/migrations/20261126080000_age_and_guardians.sql#L118) |  |
| `public.angler_group_catch_post(uuid, uuid, date, text, integer, text)` | [20261126080000](../supabase/migrations/20261126080000_age_and_guardians.sql#L460) |  |
| `public.angler_group_catch_remove(uuid, bigint)` | [20261126150100](../supabase/migrations/20261126150100_group_catch_moderation.sql#L49) |  |
| `public.angler_group_catch_report(uuid, bigint)` | [20261126150100](../supabase/migrations/20261126150100_group_catch_moderation.sql#L37) |  |
| `public.angler_group_catches(uuid, bigint)` | [20261126150100](../supabase/migrations/20261126150100_group_catch_moderation.sql#L14) |  |
| `public.angler_group_create(uuid, text)` | [20261123110524](../supabase/migrations/20261123110524_private_fishing_groups.sql#L125) |  |
| `public.angler_group_dissolve(uuid)` | [20261123110524](../supabase/migrations/20261123110524_private_fishing_groups.sql#L133) |  |
| `public.angler_group_invite(uuid)` | [20261123110524](../supabase/migrations/20261123110524_private_fishing_groups.sql#L127) |  |
| `public.angler_group_join(uuid)` | [20261123110524](../supabase/migrations/20261123110524_private_fishing_groups.sql#L129) |  |
| `public.angler_group_leave(uuid)` | [20261123110524](../supabase/migrations/20261123110524_private_fishing_groups.sql#L131) |  |
| `public.angler_group_link(uuid)` | [20261127121000](../supabase/migrations/20261127121000_review_journal_and_community.sql#L255) |  |
| `public.angler_group_members(uuid, uuid)` | [20261127121000](../supabase/migrations/20261127121000_review_journal_and_community.sql#L290) |  |
| `public.angler_group_monthly(uuid, boolean)` | [20261124122642](../supabase/migrations/20261124122642_optional_group_monthly_challenge.sql#L40) |  |
| `public.angler_group_remove_member(uuid, uuid)` | [20261127121000](../supabase/migrations/20261127121000_review_journal_and_community.sql#L305) |  |
| `public.angler_group_revoke(uuid)` | [20261127121000](../supabase/migrations/20261127121000_review_journal_and_community.sql#L281) |  |
| `public.angler_group_tip_change(uuid, bigint, text, text, text)` | [20261127032314](../supabase/migrations/20261127032314_journal_community_controls.sql#L40) |  |
| `public.angler_group_tip_post(uuid, uuid, text)` | [20261123142819](../supabase/migrations/20261123142819_private_group_tips.sql#L76) |  |
| `public.angler_group_tips(uuid, bigint)` | [20261123142819](../supabase/migrations/20261123142819_private_group_tips.sql#L79) |  |
| `public.angler_groups()` | [20261123110524](../supabase/migrations/20261123110524_private_fishing_groups.sql#L123) |  |
| `public.angler_journal_sync(text, jsonb)` | [20261127100000](../supabase/migrations/20261127100000_private_photo_retention.sql#L279) |  |
| `public.angler_latest_reply()` | [20261127032314](../supabase/migrations/20261127032314_journal_community_controls.sql#L329) |  |
| `public.angler_market_activate()` | [20261123232227](../supabase/migrations/20261123232227_test_tip_market.sql#L172) |  |
| `public.angler_market_buy(uuid, integer, integer)` | [20261125075304](../supabase/migrations/20261125075304_play_market_settlement.sql#L112) |  |
| `public.angler_market_detail(uuid)` | [20261123232227](../supabase/migrations/20261123232227_test_tip_market.sql#L168) |  |
| `public.angler_market_discover(text, bigint)` | [20261124004714](../supabase/migrations/20261124004714_european_market_directory.sql#L2078) |  |
| `public.angler_market_list(text, bigint)` | [20261123232227](../supabase/migrations/20261123232227_test_tip_market.sql#L164) |  |
| `public.angler_market_publish(uuid, integer, jsonb)` | [20261124004714](../supabase/migrations/20261124004714_european_market_directory.sql#L2047) |  |
| `public.angler_market_rate(uuid, integer, integer, integer)` | [20261124000054](../supabase/migrations/20261124000054_purchased_tip_ratings.sql#L60) |  |
| `public.angler_market_withdraw(uuid)` | [20261123232227](../supabase/migrations/20261123232227_test_tip_market.sql#L184) |  |
| `public.angler_message_block(uuid, boolean)` | [20261123155308](../supabase/migrations/20261123155308_private_messages.sql#L160) |  |
| `public.angler_message_history(uuid, uuid, bigint)` | [20261123155308](../supabase/migrations/20261123155308_private_messages.sql#L156) |  |
| `public.angler_message_inbox(bigint)` | [20261123155308](../supabase/migrations/20261123155308_private_messages.sql#L154) |  |
| `public.angler_message_react(uuid, bigint, text)` | [20261123160129](../supabase/migrations/20261123160129_message_reactions.sql#L95) |  |
| `public.angler_message_read(uuid, bigint)` | [20261127032314](../supabase/migrations/20261127032314_journal_community_controls.sql#L247) |  |
| `public.angler_message_report(uuid, bigint)` | [20261123155308](../supabase/migrations/20261123155308_private_messages.sql#L162) |  |
| `public.angler_message_send(uuid, uuid, uuid, text)` | [20261123155308](../supabase/migrations/20261123155308_private_messages.sql#L158) |  |
| `public.angler_my_details(jsonb)` | [20261126080000](../supabase/migrations/20261126080000_age_and_guardians.sql#L417) |  |
| `public.angler_open_catch_card(uuid)` | [20261123180057](../supabase/migrations/20261123180057_public_catch_cards.sql#L126) |  |
| `public.angler_parking_feedback(uuid, bigint)` | [20261126060000](../supabase/migrations/20261126060000_community_protection.sql#L141) |  |
| `public.angler_parking_list(text)` | [20261125045854](../supabase/migrations/20261125045854_community_parking.sql#L115) |  |
| `public.angler_parking_remove(text, uuid, integer)` | [20261127121000](../supabase/migrations/20261127121000_review_journal_and_community.sql#L231) |  |
| `public.angler_parking_review(uuid, integer, text)` | [20261126060000](../supabase/migrations/20261126060000_community_protection.sql#L146) |  |
| `public.angler_parking_save(text, uuid, integer, numeric, numeric, text)` | [20261125045854](../supabase/migrations/20261125045854_community_parking.sql#L117) |  |
| `public.angler_parking_waters()` | [20261125045854](../supabase/migrations/20261125045854_community_parking.sql#L113) |  |
| `public.angler_play_receipt(text, jsonb)` | [20261125075304](../supabase/migrations/20261125075304_play_market_settlement.sql#L247) |  |
| `public.angler_post_signal(uuid)` | [20261126060100](../supabase/migrations/20261126060100_favourite_post_watches.sql#L4) |  |
| `public.angler_profile()` | [20261126080000](../supabase/migrations/20261126080000_age_and_guardians.sql#L19) |  |
| `public.angler_public_card_options(uuid, text)` | [20261123180057](../supabase/migrations/20261123180057_public_catch_cards.sql#L118) |  |
| `public.angler_public_card_publish(uuid, uuid, jsonb, text, text)` | [20261123180057](../supabase/migrations/20261123180057_public_catch_cards.sql#L120) |  |
| `public.angler_public_card_withdraw(uuid)` | [20261123180057](../supabase/migrations/20261123180057_public_catch_cards.sql#L124) |  |
| `public.angler_public_cards(bigint)` | [20261123180057](../supabase/migrations/20261123180057_public_catch_cards.sql#L122) |  |
| `public.angler_register(text, text, text, date)` | [20261127121000](../supabase/migrations/20261127121000_review_journal_and_community.sql#L333) |  |
| `public.angler_register_post_watch(uuid)` | [20261124101500](../supabase/migrations/20261124101500_post_notifications.sql#L23) |  |
| `public.angler_registration_profile()` | [20261127121000](../supabase/migrations/20261127121000_review_journal_and_community.sql#L323) |  |
| `public.angler_report_catch_card(uuid)` | [20261126060000](../supabase/migrations/20261126060000_community_protection.sql#L74) |  |
| `public.angler_report_content(text, uuid)` | [20261126060000](../supabase/migrations/20261126060000_community_protection.sql#L85) |  |
| `public.angler_report_parking_note(bigint, text)` | [20261126060000](../supabase/migrations/20261126060000_community_protection.sql#L153) |  |
| `public.angler_save_card(integer, text, text, text, integer, text, boolean)` | [20261123112814](../supabase/migrations/20261123112814_angler_profile_cards.sql#L208) |  |
| `public.angler_top_species()` | [20261124122648](../supabase/migrations/20261124122648_volunteered_species_counts.sql#L50) |  |
| `public.angler_top_waters()` | [20261124122638](../supabase/migrations/20261124122638_water_reviews_and_visit_statistics.sql#L47) |  |
| `public.angler_trip_species(uuid, integer, bigint, jsonb)` | [20261124122648](../supabase/migrations/20261124122648_volunteered_species_counts.sql#L38) |  |
| `public.angler_watch_community(uuid)` | [20261127032314](../supabase/migrations/20261127032314_journal_community_controls.sql#L312) |  |
| `public.angler_watch_favourites(uuid, text[])` | [20261126060100](../supabase/migrations/20261126060100_favourite_post_watches.sql#L18) |  |
| `public.angler_water_alerts(text)` | [20261124041826](../supabase/migrations/20261124041826_water_reports.sql#L29) |  |
| `public.angler_water_discussion(text, uuid, bigint)` | [20261123153421](../supabase/migrations/20261123153421_water_discussions.sql#L143) |  |
| `public.angler_water_manifest()` | [20261124060000](../supabase/migrations/20261124060000_water_directory.sql#L10) |  |
| `public.angler_water_rate(text, integer)` | [20261124122638](../supabase/migrations/20261124122638_water_reviews_and_visit_statistics.sql#L45) |  |
| `public.angler_water_rating(text)` | [20261124122638](../supabase/migrations/20261124122638_water_reviews_and_visit_statistics.sql#L43) |  |
| `public.angler_water_report(text, text, boolean)` | [20261124041826](../supabase/migrations/20261124041826_water_reports.sql#L15) |  |
| `public.angler_weekly_board(uuid, date, integer, text)` | [20261123163226](../supabase/migrations/20261123163226_group_catch_week.sql#L177) |  |
| `public.angler_weekly_enter(uuid, uuid, uuid, date, text, text)` | [20261123163226](../supabase/migrations/20261123163226_group_catch_week.sql#L175) |  |
| `public.angler_weekly_report(uuid, uuid)` | [20261123163226](../supabase/migrations/20261123163226_group_catch_week.sql#L181) |  |
| `public.angler_weekly_vote(uuid, uuid, boolean)` | [20261123163226](../supabase/migrations/20261123163226_group_catch_week.sql#L179) |  |
| `public.angler_weekly_withdraw(uuid, uuid)` | [20261123163226](../supabase/migrations/20261123163226_group_catch_week.sql#L183) |  |
