import { today, validDay } from './domain.js';
import { newJournalId } from './journal.js';
import { rpc } from './profile-api.js';
import {
  screen,
  t,
  cs,
  esc,
  by,
  bind,
  back,
  bindBack,
  button,
  field,
  displayDay,
  confirmAction,
  submitChange,
  toast,
  trackEdits,
} from './ui.js';

const postTime = new Intl.DateTimeFormat(cs ? 'cs-CZ' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const questions = () => t('Dotazy u revíru', 'Water questions');
const reply = () => t('Odpovědět', 'Reply');
const withdraw = () => t('Stáhnout příspěvek', 'Withdraw post');
const report = () => t('Nahlásit příspěvek', 'Report post');

function errorText(error) {
  if (error.status === 401 || error.status === 403)
    return t(
      'Pro diskusi se přihlas k ověřenému účtu.',
      'Sign in with a verified account to use discussions.',
    );
  if (error.status === 404)
    return t('Diskuse nebo příspěvek už nejsou dostupné.', 'This discussion or post is no longer available.');
  if (error.status === 400) return t('Zkontroluj text a datum výpravy.', 'Check your text and trip date.');
  if (error.status === 409)
    return t(
      'Tento příspěvek se mezitím změnil. Znovu otevři diskusi.',
      'This post changed. Reopen the discussion.',
    );
  return t('Připojení se nezdařilo. Zkus to znovu.', 'Could not connect. Please retry.');
}

function postCard(item) {
  const card = document.createElement('article');
  card.className = 'surface discussion-post';
  card.innerHTML =
    '<p class="meta">' +
    esc(item.author) +
    ' · ' +
    t('Publikováno', 'Posted') +
    ' ' +
    esc(postTime.format(new Date(item.postedAt))) +
    '</p>' +
    '<p class="discussion-body">' +
    esc(item.body) +
    '</p>' +
    (item.tripDay
      ? '<p class="meta">' + t('Datum výpravy', 'Trip date') + ' · ' + esc(displayDay(item.tripDay)) + '</p>'
      : '') +
    (item.helpful
      ? '<p class="discussion-helpful">' +
        t('Tazatel označil jako užitečné', 'Marked helpful by the angler who asked') +
        '</p>'
      : '');
  if (item.replyCount !== undefined) {
    const count = document.createElement('p');
    count.className = 'meta';
    count.textContent = t('Počet odpovědí', 'Replies') + ' · ' + item.replyCount;
    card.append(count);
  }
  return card;
}

function action(card, label, callback, style = 'secondary') {
  let row = card.querySelector('.actions');
  if (!row) {
    row = document.createElement('div');
    row.className = 'actions';
    card.append(row);
  }
  const control = document.createElement('button');
  control.type = 'button';
  control.className = style;
  control.textContent = label;
  control.onclick = callback;
  row.append(control);
  return control;
}

/** Read a water feed or a single question. The atlas itself remains usable without a connection. */
export async function waterDiscussion({ view, nav, pack }) {
  const { id, questionId = null } = view.route;
  const water = pack.waters.find((w) => w.id === id);
  const key = pack.country + ':' + id;
  screen.innerHTML =
    back(t('Zpět', 'Back')) +
    '<div class="page-intro"><p class="meta">' +
    esc(water.name) +
    ' · ' +
    esc(water.number) +
    '</p><h1>' +
    (questionId ? t('Dotaz u revíru', 'Water question') : questions()) +
    '</h1></div>' +
    '<div id="discussion-root"></div><div class="actions" id="discussion-tools" hidden>' +
    button('discussion-compose', questionId ? reply() : t('Položit dotaz', 'Ask a question'), 'primary') +
    button('discussion-refresh', t('Obnovit', 'Refresh'), 'secondary') +
    '</div>' +
    '<h2 id="answers-title" hidden>' +
    t('Odpovědi', 'Answers') +
    '</h2><div id="discussion-items"></div>' +
    '<p id="discussion-status" role="status"></p>' +
    button('discussion-more', t('Starší příspěvky', 'Older posts'), 'secondary') +
    button('discussion-retry', t('Zkusit znovu', 'Retry'), 'secondary') +
    button('discussion-signin', t('Přihlásit se', 'Sign in'), 'secondary');
  bindBack(nav);
  const more = by('discussion-more'),
    retry = by('discussion-retry'),
    status = by('discussion-status');
  const signIn = by('discussion-signin');
  signIn.hidden = more.hidden = retry.hidden = true;
  signIn.onclick = () => window.Device.profileSignIn();
  let question,
    next = null,
    loading = false;
  bind('discussion-compose', () =>
    nav.open('discussionComposer', { id, questionId, questionText: question?.body }),
  );
  bind('discussion-refresh', () => nav.show());

  function makeCard(item, isRoot) {
    const card = postCard(item);
    if (!questionId) {
      action(card, t('Otevřít dotaz', 'Open question'), () =>
        nav.open('waterDiscussion', { id, questionId: item.id }),
      );
      return card;
    }
    const failed = (err) => toast(errorText(err));
    if (item.mine) {
      action(
        card,
        withdraw(),
        async () => {
          const accepted = await confirmAction({
            title: withdraw() + '?',
            accept: withdraw(),
            destructive: true,
            message: isRoot
              ? t(
                  'Dotaz i všechny odpovědi zmizí z diskuse.',
                  'The question and all its replies will be removed.',
                )
              : t('Tvoje odpověď zmizí z diskuse.', 'Your answer will be removed.'),
          });
          if (accepted && view.active())
            await submitChange(
              view,
              () => rpc('discussion_withdraw', { water_key: key, post_id: item.id }),
              () => (isRoot ? nav.back() : nav.show()),
              failed,
            );
        },
        'danger',
      );
    } else {
      if (isRoot) {
        const privateReply = action(card, t('Odpovědět soukromě', 'Reply privately'), () =>
          nav.open('messageThread', { questionId: item.id }),
        );
        privateReply.id = 'private-reply';
      }
      const flag = action(card, report(), async () => {
        const accepted = await confirmAction({
          title: report() + '?',
          accept: report(),
          message: t(
            'Příspěvek předáš správci pilotu ke kontrole.',
            'Send this post to the pilot operator for review.',
          ),
        });
        if (accepted && view.active())
          await submitChange(
            view,
            () => rpc('discussion_report', { water_key: key, post_id: item.id }),
            () => {
              item.reported = true;
              flag.disabled = true;
              flag.textContent = t('Nahlášeno', 'Reported');
            },
            failed,
          );
      });
      if (item.reported) {
        flag.disabled = true;
        flag.textContent = t('Nahlášeno', 'Reported');
      }
      if (!isRoot && question.mine) {
        action(
          card,
          item.helpful ? t('Zrušit označení', 'Remove helpful mark') : t('Užitečná odpověď', 'Mark helpful'),
          () =>
            submitChange(
              view,
              () => rpc('discussion_helpful', { water_key: key, answer_id: item.id, marked: !item.helpful }),
              () => {
                card.replaceWith(makeCard({ ...item, helpful: !item.helpful }, false));
              },
              failed,
            ),
        );
      }
    }
    return card;
  }

  async function loadPage() {
    if (loading || view.saving || !view.active()) return;
    loading = true;
    signIn.hidden = retry.hidden = more.hidden = true;
    status.textContent = t('Načítám diskusi…', 'Loading discussion…');
    try {
      const page = await rpc('water_discussion', {
        water_key: key,
        question_id: questionId,
        before_position: next,
      });
      if (!view.active()) return;
      if (!next) {
        question = page.question;
        if (question) {
          by('discussion-root').append(makeCard(question, true));
          by('answers-title').hidden = false;
        }
        by('discussion-tools').hidden = false;
      }
      for (const item of page.items) by('discussion-items').append(makeCard(item, false));
      next = page.next;
      more.hidden = !next;
      status.textContent = by('discussion-items').childElementCount
        ? ''
        : questionId
          ? t('Zatím žádná odpověď.', 'No answers yet.')
          : t('Zatím se tu nikdo nezeptal.', 'No questions here yet.');
    } catch (err) {
      if (view.active()) {
        status.textContent = errorText(err);
        retry.hidden = false;
        signIn.hidden = err.status !== 401;
      }
    } finally {
      loading = false;
    }
  }
  more.onclick = retry.onclick = loadPage;
  await loadPage();
}

/** The composer contains only newly authored text and an optional, explicit trip date. */
export function discussionComposer({ view, nav, pack }) {
  const { id, questionId = null } = view.route;
  const water = pack.waters.find((w) => w.id === id);
  const publish = questionId ? t('Zveřejnit odpověď', 'Post answer') : t('Zveřejnit dotaz', 'Post question');
  screen.innerHTML =
    back(t('Zpět', 'Back')) +
    '<div class="page-intro"><p class="meta">' +
    esc(water.name) +
    '</p><h1>' +
    (questionId ? t('Odpověď u revíru', 'Answer at this water') : t('Nový dotaz', 'New question')) +
    '</h1></div>' +
    (questionId
      ? '<blockquote class="discussion-context">' + esc(view.route.questionText) + '</blockquote>'
      : '') +
    '<form id="discussion-form" class="entry-form"><section class="surface">' +
    field(
      'discussion-text',
      questionId
        ? t('Tvoje odpověď', 'Your answer')
        : t('Na co se chceš zeptat?', 'What would you like to ask?'),
      '<textarea id="discussion-text" rows="5" maxlength="1600" required></textarea>',
    ) +
    (questionId
      ? field(
          'discussion-day',
          t('Datum výpravy (nepovinné)', 'Trip date (optional)'),
          '<input id="discussion-day" type="date" max="' + esc(today(pack.zone)) + '">',
        )
      : '') +
    '<p class="meta">' +
    t(
      'Příspěvek uvidí přihlášení rybáři spolu s tvou přezdívkou.',
      'Signed-in anglers will see this post and your display name.',
    ) +
    '</p><p id="discussion-error" role="alert"></p></section><div class="savebar"><button class="primary">' +
    publish +
    '</button></div></form>';
  bindBack(nav);
  const form = by('discussion-form');
  trackEdits(form, view);
  let attempt;
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (view.saving || !view.active()) return;
    const message = by('discussion-text').value.trim(),
      day = by('discussion-day')?.value || null;
    const error = by('discussion-error');
    if (!message || (day && (!validDay(day) || day > today(pack.zone)))) {
      error.textContent = t('Zkontroluj text a datum výpravy.', 'Check your text and trip date.');
      return;
    }
    const confirmed = await confirmAction({
      title: publish + '?',
      accept: publish,
      message:
        water.name +
        '\n\n' +
        message +
        (day ? '\n\n' + t('Datum výpravy', 'Trip date') + ' · ' + displayDay(day) : ''),
    });
    if (!confirmed || !view.active()) return;
    if (!attempt || attempt.message !== message || attempt.trip_day !== day)
      attempt = {
        water_key: pack.country + ':' + id,
        question_id: questionId,
        request_id: newJournalId(),
        message,
        trip_day: day,
      };
    error.textContent = '';
    await submitChange(
      view,
      async () => {
        const receipt = await rpc('discussion_post', attempt);
        if (receipt.id?.replaceAll('-', '') !== attempt.request_id.replaceAll('-', ''))
          throw Error('Invalid discussion receipt');
      },
      () => {
        view.dirty = false;
        nav.back();
      },
      (err) => {
        error.textContent = errorText(err);
      },
    );
  };
}
