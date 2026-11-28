import assert from 'node:assert/strict';
import {anglerDetails} from '../../app/src/main/assets/angler-details.js';
import {weeklyGroups, weeklyBoard} from '../../app/src/main/assets/weekly-catch.js';
import {profileScreen, editProfile, directoryScreen} from '../../app/src/main/assets/profiles.js';
import {evidenceScreen, reviewScreen} from '../../app/src/main/assets/verification.js';
import {marketDetail, marketShelf, marketEditor} from '../../app/src/main/assets/market.js';
import {myPublicCards} from '../../app/src/main/assets/public-cards.js';
import {activityContribution, waterActivity, myActivity} from '../../app/src/main/assets/water-activity.js';

// The message, retry action and sign-in affordance are public screen behavior independent of the transport order tests.
const profile = {401:'profile_api.sign_in_again_to_use_the_online', 403:'profile_api.you_do_not_have_access_to_this',
  404:'profile_api.this_profile_is_private_or_no_longer', 409:'profile_api.the_record_changed_or_the_photo_was',
  429:'limits.hourly', 503:'profile-api.service.unavailable.check.your.connection.and.retry'};
const market = {401:'market.sign_in_with_a_verified_account', 402:'market.you_have_too_few_test_credits_for',
  404:'market.this_offer_is_no_longer_available', 409:'market.the_terms_or_remaining_availability_changed_review',
  422:'market.check_the_offer_details', 429:'limits.hourly', 503:'market.connection_failed_please_retry'};
const weekly = {401:'weekly_catch.sign_in_again_to_use_the_competition', 403:'weekly_catch.check_that_you_are_still_in_the',
  404:'weekly_catch.this_entry_is_no_longer_available', 409:'weekly_catch.this_catch_was_already_entered_or_withdrawn',
  422:'weekly_catch.this_catch_or_vote_is_outside_the', 429:'limits.hourly', 503:'common.could_not_connect_please_retry'};
const activity = {401:'water_activity.sign_in_again_to_use_water_activity', 409:'water_activity.the_contribution_changed_refresh_the_screen',
  422:'water_activity.check_the_period_and_fish_count', 429:'limits.hourly', 503:'common.service_unavailable_check_your_connection_and_retry'};
const cards = {401:'public_cards.sign_in_again_to_manage_cards', 409:'public_cards.the_details_or_link_changed_refresh_the',
  422:'public_cards.check_the_date_species_and_selected_photo', 429:'limits.hourly', 503:'common.service_unavailable_check_your_connection_and_retry'};
const screens = [
  [anglerDetails,'my_details',profile,'retry-details'], [profileScreen,'card',profile,'retry-profile'],
  [editProfile,'card',profile,'retry-profile'], [directoryScreen,'directory',profile,'retry-profile'],
  [evidenceScreen,'evidence_list',profile,'retry-profile'], [reviewScreen,'evidence_review',profile,'retry-profile'],
  [marketDetail,'market_detail',market,'market-reload'], [marketShelf,'market_list',market,'market-reload'],
  [marketEditor,'market_detail',market,'market-reload'], [weeklyGroups,'groups',weekly,'weekly-retry'],
  [weeklyBoard,'weekly_board',weekly,'weekly-retry'], [myPublicCards,'public_cards',cards,'refresh-public'],
  [activityContribution,'activity_state',activity,'activity-retry'], [waterActivity,'activity_summary',activity,'activity-retry'],
  [myActivity,'activity_mine',activity,'activity-retry'],
];
export async function run({check, words, json}) {
  const host = document.querySelector('#screen'), pack = json('catalog.json');
  const site = {...pack.waters[0],country:'CZ',key:'CZ:fixture'};
  const waterDirectory = {byId:new Map([[site.id,site]]), byKey:new Map([[site.key,site]]), waters:[site]};
  for (const [screen, op, messages, retry] of screens) for (const [status, key] of Object.entries(messages)) {
    for (const retired of [false, true]) await check(`${screen.name}/${status}/${retired ? 'left' : 'visible'}`, async () => {
      let mounted = true, calls = 0, retryCount = 0;
      const view = {active:() => mounted, route:{id:site.id, groupId:'group', shelf:'mine'}};
      window.Device.profileRequest = (id, actual) => {
        assert.equal(actual, op);
        calls++;
        queueMicrotask(() => {
          if (retired) { mounted = false; host.textContent = 'Replacement screen'; }
          window.profileReply(id, Number(status), 'fixture');
        });
      };
      host.replaceChildren();
      await screen({view, nav:{show:() => { retryCount++; }}, pack, waterDirectory});
      assert.equal(calls, 1);
      if (retired) { assert.equal(host.textContent, 'Replacement screen'); return; }
      assert.equal(host.querySelector('[role="alert"]').textContent, words(key));
      host.querySelector('#' + retry).click();
      assert.equal(retryCount, 1);
      if (retry === 'retry-profile' || retry === 'weekly-retry') {
        assert.equal(!!host.querySelector('#sign-in,#weekly-signin'), status === '401');
      }
    });
  }
}
