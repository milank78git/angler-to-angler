import { languageTag } from './i18n.js';
import { today, validDay } from './domain.js';
import { newJournalId } from './journal.js';
import { rpc } from './profile-api.js';
import {
  screen,
  t,
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

const postTime = new Intl.DateTimeFormat(languageTag, { dateStyle: 'medium', timeStyle: 'short' });
const questions = () => t('Poznatky a dotazy', 'Observations and questions');
const reply = () => t('Odpovědět', 'Reply');
const withdraw = () => t('Stáhnout příspěvek', 'Withdraw post');
const removed = () => t('Text příspěvku byl odstraněn.', 'The text of this post was removed.');
const linked = () =>
  t(
    'Příspěvek už má textovou odpověď a zůstává ve vlákně.',
    'This post has a text reply and stays in the thread.',
  );
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
    esc(item.removed ? t('Odstraněný příspěvek', 'Removed post') : item.author) +
    ' · ' +
    t('Publikováno', 'Posted') +
    ' ' +
    esc(postTime.format(new Date(item.postedAt))) +
    '</p>' +
    (item.replyTo
      ? '<blockquote class="discussion-context"><strong>' +
        esc(
          item.replyTo.author
            ? t('Odpověď pro ', 'Reply to ') + item.replyTo.author
            : t('Odpověď na příspěvek', 'In reply to a post'),
        ) +
        '</strong><br>' +
        esc(item.replyTo.excerpt ?? removed()) +
        '</blockquote>'
      : '') +
    '<p class="discussion-body">' +
    esc(item.body ?? removed()) +
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
export async function waterDiscussion({ view, nav, waterDirectory }) {
  const { id, questionId = null } = view.route;
  const water = waterDirectory.byId.get(id);
  if (!water) return nav.back();
  const key = water.key;
  screen.innerHTML =
    back(t('Zpět', 'Back')) +
    '<div class="page-intro"><p class="meta">' +
    esc(water.name) +
    ' · ' +
    esc(water.number) +
    '</p><h1>' +
    (questionId ? t('Příspěvek u revíru', 'Water post') : questions()) +
    '</h1></div>' +
    '<div id="discussion-root"></div><div class="actions" id="discussion-tools" hidden>' +
    button('discussion-compose', questionId ? reply() : t('Přidat poznatek nebo dotaz', 'Share an observation or question'), 'primary') +
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
      action(card, t('Otevřít příspěvek', 'Open post'), () =>
        nav.open('waterDiscussion', { id, questionId: item.id }),
      );
      return card;
    }
    const failed = (err) => toast(errorText(err));
    if (item.removed) return card;
    if (item.mine && !item.canWithdraw) {
      const reason = document.createElement('p');
      reason.className = 'meta withdrawal-locked';
      reason.textContent = linked();
      card.append(reason);
    } else if (item.mine) {
      action(
        card,
        withdraw(),
        async () => {
          const accepted = await confirmAction({
            title: withdraw() + '?',
            accept: withdraw(),
            destructive: true,
            message: t('Tvůj text zmizí z diskuse.', 'Your text will be removed from the discussion.'),
          });
          if (accepted && view.active())
            await submitChange(
              view,
              () => rpc('discussion_withdraw', { water_key: key, post_id: item.id }),
              () => (isRoot ? nav.back() : nav.show()),
              (error) => {
                if (error.status === 409) {
                  toast(linked());
                  nav.show();
                } else failed(error);
              },
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
      flag.classList.add('report-post');
      if (item.reported) {
        flag.disabled = true;
        flag.textContent = t('Nahlášeno', 'Reported');
      }
      if (!isRoot && question.mine) {
        const mark = action(
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
        mark.classList.add('mark-helpful');
      }
    }
    if (!isRoot && !question.removed) {
      const respond = action(card, t('Odpovědět na příspěvek', 'Reply to this post'), () =>
        nav.open('discussionComposer', {
          id,
          questionId,
          replyToId: item.id,
          questionText: item.body,
          replyAuthor: item.author,
        }),
      );
      respond.classList.add('reply-to-post');
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
          by('discussion-compose').hidden = !!question.removed;
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
          : t('Zatím tu nejsou žádné příspěvky.', 'No posts here yet.');
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
export function discussionComposer({ view, nav, waterDirectory }) {
  const { id, questionId = null } = view.route;
  const water = waterDirectory.byId.get(id);
  if (!water) return nav.back();
  const publish = questionId ? t('Zveřejnit odpověď', 'Post answer') : t('Zveřejnit příspěvek', 'Publish post');
  screen.innerHTML =
    back(t('Zpět', 'Back')) +
    '<div class="page-intro"><p class="meta">' +
    esc(water.name) +
    '</p><h1>' +
    (questionId ? t('Odpověď u revíru', 'Answer at this water') : t('Nový příspěvek', 'New post')) +
    '</h1></div>' +
    (questionId
      ? '<blockquote class="discussion-context">' +
        (view.route.replyAuthor
          ? '<strong>' + esc(t('Odpověď pro ', 'Reply to ') + view.route.replyAuthor) + '</strong><br>'
          : '') +
        esc(view.route.questionText) +
        '</blockquote>'
      : '') +
    '<form id="discussion-form" class="entry-form"><section class="surface">' +
    field(
      'discussion-text',
      questionId
        ? t('Tvoje odpověď', 'Your answer')
        : t('Co jsi u vody zjistil nebo na co se chceš zeptat?', 'What did you observe or what would you like to ask?'),
      '<textarea id="discussion-text" rows="5" maxlength="1600" required></textarea>',
    ) +
    (questionId
      ? field(
          'discussion-day',
          t('Datum výpravy (nepovinné)', 'Trip date (optional)'),
          '<input id="discussion-day" type="date" max="' + esc(today(water.zone)) + '">',
        )
      : '') +
    '<p class="meta">' +
    t(
      'Příspěvek uvidí přihlášení rybáři spolu s tvou přezdívkou.',
      'Signed-in anglers will see this post and your display name.',
    ) +
    '</p><p id="discussion-error" role="alert"></p></section><div class="savebar"><button type="submit" class="primary">' +
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
    if (!message || (day && (!validDay(day) || day > today(water.zone)))) {
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
        water_key: water.key,
        question_id: questionId,
        ...(view.route.replyToId ? { reply_to_id: view.route.replyToId } : {}),
        request_id: newJournalId(),
        message,
        trip_day: day,
      };
    error.textContent = '';
    await submitChange(
      view,
      async () => {
        const receipt = await rpc(view.route.replyToId ? 'discussion_reply' : 'discussion_post', attempt);
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
