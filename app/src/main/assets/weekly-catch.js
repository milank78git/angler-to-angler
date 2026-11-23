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

const title = () => t('Úlovek týdne', 'Catch of the week');
const photoUrl = (bytes) => 'data:image/webp;base64,' + bytes;
const nominate = () => t('Přihlásit úlovek', 'Enter catch');

function problem(error) {
  if (error.status === 401) return t('Pro soutěž se znovu přihlas.', 'Sign in again to use the competition.');
  if (error.status === 403)
    return t('Zkontroluj, zda jsi stále členem party.', 'Check that you are still in the group.');
  if (error.status === 404) return t('Úlovek už v soutěži není.', 'This entry is no longer available.');
  if (error.status === 409)
    return t(
      'Tento úlovek už byl přihlášen nebo stažen. Obnov pořadí.',
      'This catch was already entered or withdrawn. Refresh the ranking.',
    );
  if (error.status === 422)
    return t(
      'Do tohoto kola už nelze přidat úlovek ani hlas.',
      'This catch or vote is outside the open round.',
    );
  if (error.status === 400)
    return t('Zkontroluj fotografii a údaje úlovku.', 'Check the photo and catch details.');
  return t('Připojení se nezdařilo. Zkus to znovu.', 'Could not connect. Please retry.');
}

function readError(view, nav, err) {
  if (!view.active()) return;
  screen.innerHTML =
    back(t('Zpět', 'Back')) +
    '<h1>' +
    title() +
    '</h1><p role="alert">' +
    problem(err) +
    '</p>' +
    button('weekly-retry', t('Zkusit znovu', 'Retry'), 'secondary') +
    (err.status === 401 ? button('weekly-signin', t('Přihlásit se', 'Sign in'), 'primary') : '');
  bindBack(nav);
  bind('weekly-retry', () => nav.show());
  if (by('weekly-signin')) bind('weekly-signin', () => window.Device.profileSignIn());
}

/** Choose the audience explicitly, including when entering directly from a local photo. */
export async function weeklyGroups({ view, nav }) {
  let groups;
  try {
    ({ groups } = await rpc('groups'));
  } catch (err) {
    return readError(view, nav, err);
  }
  if (!view.active()) return;
  const { tripId, catchId } = view.route;
  screen.innerHTML =
    back(t('Zpět', 'Back')) +
    '<h1>' +
    title() +
    '</h1>' +
    (groups.length
      ? '<h2>' + t('Vyber partu', 'Choose a group') + '</h2><div class="weekly-groups"></div>'
      : emptyState(
          'fish-symbol',
          t('Zatím nejsi v partě.', 'You have not joined a group yet.'),
          t(
            'V nastavení účtu můžeš založit partu nebo přijmout pozvánku.',
            'Create a group or accept an invitation in account settings.',
          ),
        ) + button('weekly-settings', t('Nastavení účtu', 'Account settings'), 'secondary'));
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
  card.innerHTML =
    '<img class="weekly-photo" alt="' +
    esc(item.species) +
    '" src="' +
    esc(photoUrl(item.photo)) +
    '">' +
    '<div><p class="meta">' +
    (item.held ? t('Čeká na kontrolu', 'Under review') : t('Pořadí', 'Rank') + ' · ' + esc(item.place)) +
    '</p><h2>' +
    esc(item.species) +
    '</h2><p>' +
    esc(item.author) +
    ' · ' +
    displayDay(item.day) +
    '</p><p class="weekly-score">' +
    t('Hlasy', 'Votes') +
    ' · ' +
    esc(item.score) +
    '</p></div>';
  if (!item.mine) {
    const flag = document.createElement('button');
    flag.type = 'button';
    flag.className = 'secondary';
    flag.disabled = item.reported;
    const label = t('Nahlásit úlovek', 'Report entry');
    flag.textContent = item.reported ? t('Nahlášeno', 'Reported') : label;
    flag.onclick = async () => {
      const accepted = await confirmAction({
        title: label + '?',
        accept: label,
        message: t(
          'Soutěžní kartu předáš správci ke kontrole.',
          'Send this catch card to the pilot operator for review.',
        ),
      });
      if (accepted && view.active())
        await submitChange(
          view,
          () => rpc('weekly_report', { group_id: view.route.groupId, entry_id: item.id }),
          () => {
            flag.disabled = true;
            flag.textContent = t('Nahlášeno', 'Reported');
          },
          (err) => toast(problem(err)),
        );
    };
    card.append(flag);
  }
  if (!item.mine && !item.voted && !round.open) return card;
  const action = document.createElement('button');
  action.type = 'button';
  action.className = item.mine ? 'danger' : item.voted ? 'secondary' : 'primary';
  action.textContent = item.mine
    ? t('Stáhnout úlovek', 'Withdraw entry')
    : item.voted
      ? t('Odebrat hlas', 'Remove vote')
      : t('Dát hlas', 'Vote');
  action.dataset.weeklyAction = item.mine ? 'withdraw' : 'vote';
  if (!item.mine) action.setAttribute('aria-pressed', String(item.voted));
  action.onclick = async () => {
    if (
      item.mine &&
      !(await confirmAction({
        title: t('Stáhnout úlovek z pořadí?', 'Withdraw this entry?'),
        message: t(
          'Z party zmizí soutěžní fotka a její hlasy. Úlovek zůstane v deníku.',
          'The competition photo and its votes will be removed. The catch stays in your journal.',
        ),
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
    host.textContent = t(
      'Úlovek s fotografií už v deníku není.',
      'The catch photo is no longer in your journal.',
    );
    return;
  }
  if (trip.day < round.week || trip.day > round.today) {
    host.textContent = t(
      'Přihlásit můžeš jen úlovek z tohoto týdne, nejpozději z dnešního dne.',
      'Choose a catch from this week, up to and including today.',
    );
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
  host.innerHTML =
    '<section class="surface"><h2>' +
    t('Náhled pro partu', 'Group preview') +
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
    t(
      'Členové uvidí fotku, druh, datum a tvou přezdívku. Místo může být poznat podle okolí na fotce.',
      'Members will see the photo, species, date and your display name. The surroundings in the photo may reveal the spot.',
    ) +
    '</p>' +
    button('weekly-enter', nominate(), 'primary') +
    '</section>';
  view.route.requestId ??= newJournalId();
  bind('weekly-enter', async () => {
    const accepted = await confirmAction({
      title: nominate() + '?',
      message:
        t('Fotku s tvou přezdívkou uvidí parta ', 'Your photo and display name will be visible to ') +
        groupName +
        '.',
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
      toast(
        t(
          'Pořadí se změnilo. Zobrazuji aktuální výsledky.',
          'The ranking changed. Showing the latest results.',
        ),
      );
      nav.show();
      return;
    }
    return readError(view, nav, err);
  }
  if (!view.active()) return;
  r.version = round.version;
  screen.innerHTML =
    back(t('Zpět', 'Back')) +
    '<p class="meta">' +
    esc(r.groupName) +
    '</p><h1>' +
    title() +
    '</h1><p>' +
    displayDay(round.week) +
    ' – ' +
    displayDay(endOfWeek(round.week)) +
    ' · ' +
    (round.open ? t('Hlasování otevřeno', 'Voting open') : t('Hlasování uzavřeno', 'Voting closed')) +
    '</p>' +
    '<div class="actions">' +
    button('week-refresh', t('Obnovit', 'Refresh'), 'secondary') +
    (!r.catchId && round.previous ? button('week-older', t('Starší kolo', 'Older round'), 'secondary') : '') +
    (!r.catchId && round.following
      ? button('week-newer', t('Novější kolo', 'Newer round'), 'secondary')
      : '') +
    '</div>' +
    '<div id="entry-preview"></div><div class="weekly-list"></div><div class="actions">' +
    (r.offset ? button('week-prev', t('Předchozí úlovky', 'Previous catches'), 'secondary') : '') +
    (round.next != null ? button('week-next', t('Další úlovky', 'More catches'), 'secondary') : '') +
    '</div>';
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
  const list = screen.querySelector('.weekly-list');
  for (const item of round.items) list.append(entryCard(item, round, view, nav));
  if (!round.items.length)
    list.innerHTML = emptyState(
      'fish-symbol',
      t('Zatím tu není žádný úlovek.', 'No entries in this round.'),
      r.catchId
        ? ''
        : t(
            'V deníku otevři úlovek s fotkou a zvol „Přihlásit do úlovku týdne“.',
            'Open a catch with a photo in your journal and choose “Enter catch of the week”.',
          ),
    );
  if (r.catchId) {
    try {
      await entryPreview(view, nav, pack, round);
    } catch {
      if (view.active())
        by('entry-preview').textContent = t(
          'Fotku se nepodařilo připravit. Zkus Obnovit.',
          'Could not prepare the photo. Try Refresh.',
        );
    }
  }
}
