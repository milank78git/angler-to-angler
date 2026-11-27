import { replaceMarkup } from './markup.js';
import { Journal, newJournalId } from './journal.js';
import { photoPayload, rpc } from './profile-api.js';
import { competitionPhoto } from './photo.js';
import {
  back,
  bind,
  bindBack,
  button,
  by,
  confirmAction,
  displayDay,
  emptyState,
  esc,
  loc,
  screen,
  submitChange,
  t,
  toast,
} from './ui.js';

const title = () => t('common.catch_of_the_week');
const photoUrl = (bytes) => 'data:image/webp;base64,' + bytes;
const nominate = () => t('weekly_catch.enter_catch');

function problem(error) {
  if (error.status === 429) return t('limits.hourly');
  if (error.status === 401) return t('weekly_catch.sign_in_again_to_use_the_competition');
  if (error.status === 403) return t('weekly_catch.check_that_you_are_still_in_the');
  if (error.status === 404) return t('weekly_catch.this_entry_is_no_longer_available');
  if (error.status === 409) return t('weekly_catch.this_catch_was_already_entered_or_withdrawn');
  if (error.status === 422) return t('weekly_catch.this_catch_or_vote_is_outside_the');
  if (error.status === 400) return t('weekly_catch.check_the_photo_and_catch_details');
  return t('common.could_not_connect_please_retry');
}

function readError(view, nav, err) {
  if (!view.active()) return;
  replaceMarkup(
    screen,
    back(t('common.back')) +
      '<h1>' +
      title() +
      '</h1><p role="alert">' +
      problem(err) +
      '</p>' +
      button('weekly-retry', t('common.retry'), 'secondary') +
      (err.status === 401 ? button('weekly-signin', t('common.sign_in'), 'primary') : ''),
  );
  bindBack(nav);
  bind('weekly-retry', () => nav.show());
  if (by('weekly-signin')) bind('weekly-signin', () => window.Device.profileSignIn());
}

/** Choose the audience explicitly, including when entering directly from a local photo. */
/** @param {import('../../../../types/screens.js').ScreenContext} context */
export async function weeklyGroups({ view, nav }) {
  let groups;
  try {
    ({ groups } = await rpc('groups'));
    groups = groups.filter((group) => group.canShareCatch !== false);
  } catch (err) {
    return readError(view, nav, err);
  }
  if (!view.active()) return;
  const { tripId, catchId } = view.route;
  replaceMarkup(
    screen,
    back(t('common.back')) +
      '<h1>' +
      title() +
      '</h1>' +
      (groups.length
        ? '<h2>' + t('weekly_catch.choose_a_group') + '</h2><div class="weekly-groups"></div>'
        : emptyState(
            'fish-symbol',
            t('weekly_catch.you_have_not_joined_a_group_yet'),
            t('weekly_catch.create_a_group_or_accept_an_invitation'),
          ) + button('weekly-settings', t('common.account_settings'), 'secondary')),
  );
  bindBack(nav);
  if (!groups.length) bind('weekly-settings', () => window.Device.profile());
  for (const group of groups) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'secondary';
    b.textContent = group.name;
    b.onclick = () => nav.open('weeklyBoard', { groupId: group.id, groupName: group.name, tripId, catchId });
    screen.querySelector('.weekly-groups').append(b);
  }
}

function endOfWeek(monday) {
  const end = new Date(monday + 'T12:00:00Z');
  end.setUTCDate(end.getUTCDate() + 6);
  return end.toISOString().slice(0, 10);
}

function entryCard(item, round, view, nav) {
  const card = document.createElement('article');
  card.className = 'surface weekly-entry';
  replaceMarkup(
    card,
    '<img class="weekly-photo" alt="' +
      esc(item.species) +
      '" src="' +
      esc(photoUrl(item.photo)) +
      '">' +
      '<div><p class="meta">' +
      (item.held ? t('weekly_catch.under_review') : t('weekly_catch.rank') + ' · ' + esc(item.place)) +
      '</p><h2>' +
      esc(item.species) +
      '</h2><p>' +
      esc(item.author) +
      ' · ' +
      displayDay(item.day) +
      '</p><p class="weekly-score">' +
      t('weekly_catch.votes') +
      ' · ' +
      esc(item.score) +
      '</p></div>',
  );
  if (!item.mine) {
    const flag = document.createElement('button');
    flag.type = 'button';
    flag.className = 'secondary';
    flag.disabled = item.reported;
    const label = t('weekly_catch.report_entry');
    flag.textContent = item.reported ? t('common.reported') : label;
    flag.onclick = async () => {
      const accepted = await confirmAction({
        title: label + '?',
        accept: label,
        message: t('weekly_catch.send_this_catch_card_to_the_pilot'),
      });
      if (accepted && view.active())
        await submitChange(
          view,
          () => rpc('weekly_report', { group_id: view.route.groupId, entry_id: item.id }),
          () => {
            flag.disabled = true;
            flag.textContent = t('common.reported');
          },
          (err) => toast(problem(err)),
        );
    };
    card.append(flag);
  }
  if (!item.mine && item.canRemove) {
    const remove = document.createElement('button');
    remove.className = 'danger';
    remove.textContent = t('weekly_catch.withdraw_entry');
    remove.onclick = async () => {
      if (
        (await confirmAction({
          title: t('weekly_catch.withdraw_this_entry'),
          message: t('weekly_catch.the_competition_photo_and_its_votes_will'),
          accept: remove.textContent,
          destructive: true,
        })) &&
        view.active()
      )
        await submitChange(
          view,
          () => rpc('weekly_withdraw', { group_id: view.route.groupId, entry_id: item.id }),
          () => {
            view.route.offset = 0;
            nav.show();
          },
          (err) => toast(problem(err)),
        );
    };
    card.append(remove);
  }
  if (!item.mine && !item.voted && !round.open) return card;
  const action = document.createElement('button');
  action.type = 'button';
  action.className = item.mine ? 'danger' : item.voted ? 'secondary' : 'primary';
  action.textContent = item.mine
    ? t('weekly_catch.withdraw_entry')
    : item.voted
      ? t('weekly_catch.remove_vote')
      : t('weekly_catch.vote');
  action.dataset.weeklyAction = item.mine ? 'withdraw' : 'vote';
  if (!item.mine) action.setAttribute('aria-pressed', String(item.voted));
  action.onclick = async () => {
    if (
      item.mine &&
      !(await confirmAction({
        title: t('weekly_catch.withdraw_this_entry'),
        message: t('weekly_catch.the_competition_photo_and_its_votes_will'),
        accept: action.textContent,
        destructive: true,
      }))
    )
      return;
    if (!view.active()) return;
    const args = { group_id: view.route.groupId, entry_id: item.id };
    await submitChange(
      view,
      () =>
        item.mine ? rpc('weekly_withdraw', args) : rpc('weekly_vote', { ...args, selected: !item.voted }),
      () => {
        view.route.offset = 0;
        nav.show();
      },
      (err) => toast(problem(err)),
    );
  };
  card.append(action);
  return card;
}

/** Re-encode the local image and show exactly those bytes before asking for publication. */
async function entryPreview(view, nav, pack, round) {
  const { groupId, groupName, catchId, tripId } = view.route,
    host = by('entry-preview');
  const [trip, fish] = await Promise.all([Journal.trip(tripId), Journal.catchById(catchId)]);
  if (!view.active()) return;
  if (!fish?.hasPhoto || !trip || fish.tripId !== tripId) {
    host.textContent = t('weekly_catch.the_catch_photo_is_no_longer_in');
    return;
  }
  if (trip.day < round.week || trip.day > round.today) {
    host.textContent = t('weekly_catch.choose_a_catch_from_this_week_up');
    return;
  }
  const species = pack.species[fish.speciesId]
    ? loc(pack.species[fish.speciesId])
    : fish.speciesName || fish.speciesId;
  const [profile, photo] = await Promise.all([
    rpc('profile'),
    Journal.photo(catchId).then((blob) => photoPayload(blob, 640, 49152, competitionPhoto)),
  ]);
  if (!view.active()) return;
  const url = photoUrl(photo);
  replaceMarkup(
    host,
    '<section class="surface"><h2>' +
      t('weekly_catch.group_preview') +
      '</h2><img class="weekly-photo" alt="' +
      esc(species) +
      '" src="' +
      esc(url) +
      '"><h3>' +
      esc(species) +
      '</h3><p>' +
      esc(profile.name) +
      ' · ' +
      displayDay(trip.day) +
      ' · ' +
      esc(groupName) +
      '</p><p class="meta">' +
      t('weekly_catch.members_will_see_the_photo_species_date') +
      '</p>' +
      button('weekly-enter', nominate(), 'primary') +
      '</section>',
  );
  view.route.requestId ??= newJournalId();
  bind('weekly-enter', async () => {
    const accepted = await confirmAction({
      title: nominate() + '?',
      message: t('weekly_catch.your_photo_and_display_name_will_be') + groupName + '.',
      accept: nominate(),
      catchPreview: { species, water: profile.name + ' · ' + displayDay(trip.day) + ' · ' + groupName, url },
    });
    if (!accepted || !view.active()) return;
    await submitChange(
      view,
      async () => {
        const receipt = await rpc('weekly_enter', {
          group_id: groupId,
          catch_id: catchId,
          request_id: view.route.requestId,
          catch_day: trip.day,
          species,
          photo,
        });
        if (receipt.id?.replaceAll('-', '') !== view.route.requestId.replaceAll('-', ''))
          throw Error('Invalid entry receipt');
      },
      () => {
        delete view.route.catchId;
        delete view.route.requestId;
        view.route.offset = 0;
        nav.show();
      },
      (err) => toast(problem(err)),
    );
  });
}

/** @param {import('../../../../types/screens.js').ScreenContext} context */
export async function weeklyBoard({ view, nav, pack }) {
  const r = view.route;
  let round;
  try {
    round = await rpc('weekly_board', {
      group_id: r.groupId,
      week_start: r.week ?? null,
      page_offset: r.offset || 0,
      expected_version: r.offset ? r.version : null,
    });
  } catch (err) {
    if (err.status === 409 && r.offset && view.active()) {
      r.offset = 0;
      toast(t('weekly_catch.the_ranking_changed_showing_the_latest_results'));
      nav.show();
      return;
    }
    return readError(view, nav, err);
  }
  if (!view.active()) return;
  r.version = round.version;
  replaceMarkup(
    screen,
    back(t('common.back')) +
      '<p class="meta">' +
      esc(r.groupName) +
      '</p><h1>' +
      title() +
      '</h1><p>' +
      displayDay(round.week) +
      ' – ' +
      displayDay(endOfWeek(round.week)) +
      ' · ' +
      (round.open ? t('weekly_catch.voting_open') : t('weekly_catch.voting_closed')) +
      '</p>' +
      '<div class="actions">' +
      button('week-refresh', t('common.refresh'), 'secondary') +
      (!r.catchId && round.previous ? button('week-older', t('weekly_catch.older_round'), 'secondary') : '') +
      (!r.catchId && round.following
        ? button('week-newer', t('weekly_catch.newer_round'), 'secondary')
        : '') +
      '</div>' +
      (!r.catchId && !window.Device?.groupSharingOnly?.()
        ? '<details id="monthly" class="fold"><summary>' +
          t('monthly.title') +
          '</summary><div class="fold-body"></div></details>'
        : '') +
      '<div id="entry-preview"></div><div class="weekly-list"></div><div class="actions">' +
      (r.offset ? button('week-prev', t('weekly_catch.previous_catches'), 'secondary') : '') +
      (round.next != null ? button('week-next', t('weekly_catch.more_catches'), 'secondary') : '') +
      '</div>',
  );
  bindBack(nav);
  bind('week-refresh', () => {
    r.offset = 0;
    nav.show();
  });
  function step(week, offset) {
    r.week = week;
    r.offset = offset;
    nav.show();
  }
  if (by('week-older')) bind('week-older', () => step(round.previous, 0));
  if (by('week-newer')) bind('week-newer', () => step(round.following, 0));
  if (by('week-prev')) bind('week-prev', () => step(round.week, Math.max(0, r.offset - 3)));
  if (by('week-next')) bind('week-next', () => step(round.week, round.next));
  if (by('monthly')) monthlyChallenge(by('monthly'), r.groupId);
  const list = screen.querySelector('.weekly-list');
  for (const item of round.items) list.append(entryCard(item, round, view, nav));
  if (!round.items.length)
    replaceMarkup(
      list,
      emptyState(
        'fish-symbol',
        t('weekly_catch.no_entries_in_this_round'),
        r.catchId ? '' : t('weekly_catch.open_a_catch_with_a_photo_in'),
      ),
    );
  if (r.catchId) {
    try {
      await entryPreview(view, nav, pack, round);
    } catch {
      if (view.active())
        by('entry-preview').textContent = t('weekly_catch.could_not_prepare_the_photo_try_refresh');
    }
  }
}

/** Monthly enrolment is voluntary, restricted to current group members and expires each month. */
function monthlyChallenge(panel, groupId) {
  const host = panel.querySelector('.fold-body');
  let loaded = false,
    pending = false;
  async function refresh(joining = null) {
    if (pending) return;
    pending = true;
    host.textContent = t('messages.loading');
    try {
      const result = await rpc('group_monthly', { group_id: groupId, joining });
      if (!panel.isConnected) return;
      replaceMarkup(
        host,
        '<p>' +
          esc(result.month.slice(0, 7)) +
          ' · ' +
          esc(t('monthly.rules')) +
          '</p>' +
          (result.items.length
            ? '<ol>' +
              result.items
                .map(
                  (row) =>
                    '<li value="' +
                    Number(row.place) +
                    '">' +
                    esc(row.display_name) +
                    ' · ' +
                    esc(row.score) +
                    '</li>',
                )
                .join('') +
              '</ol>'
            : '<p>' + t('stats.empty') + '</p>') +
          button('month-enroll', t(result.joined ? 'monthly.leave' : 'monthly.join'), 'secondary'),
      );
      host.querySelector('button').onclick = () => refresh(!result.joined);
      loaded = true;
    } catch (err) {
      replaceMarkup(
        host,
        '<p>' + esc(problem(err)) + '</p>' + button('month-retry', t('common.retry'), 'secondary'),
      );
      host.querySelector('button').onclick = () => refresh();
    } finally {
      pending = false;
    }
  }
  panel.ontoggle = () => {
    if (panel.open && !loaded) refresh();
  };
}
