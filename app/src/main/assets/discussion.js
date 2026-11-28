import { replaceMarkup } from './markup.js';
import { languageTag, label } from './i18n.js';
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
const questions = () => t('common.observations_and_questions');
const withdraw = () => t('discussion.withdraw_post');
const removed = () => t('discussion.the_text_of_this_post_was_removed');
const linked = () => t('discussion.this_post_has_a_text_reply_and');
const report = () => t('discussion.report_post');

/** Choose the translated recovery message for the discussion service response. */
function errorText(error) {
  if (error.status === 429) return t('limits.hourly');
  if (error.status === 401 || error.status === 403) return t('discussion.sign_in_with_a_verified_account_to');
  if (error.status === 404) return t('discussion.this_discussion_or_post_is_no_longer');
  if (error.status === 400) return t('discussion.check_your_text_and_trip_date');
  if (error.status === 409) return t('discussion.this_post_changed_reopen_the_discussion');
  return t('common.could_not_connect_please_retry');
}

/** Render a post with its author, reply context and moderation state. */
function postCard(item) {
  const card = document.createElement('article');
  card.className = 'surface discussion-post';
  replaceMarkup(
    card,
    '<p class="meta">' +
      esc(item.removed ? t('discussion.removed_post') : item.author) +
      ' · ' +
      t('discussion.posted') +
      ' ' +
      esc(postTime.format(new Date(item.postedAt))) +
      '</p>' +
      (item.replyTo
        ? '<blockquote class="discussion-context"><strong>' +
          esc(
            item.replyTo.author
              ? t('discussion.reply_to') + item.replyTo.author
              : t('discussion.in_reply_to_a_post'),
          ) +
          '</strong><br>' +
          esc(item.replyTo.excerpt ?? removed()) +
          '</blockquote>'
        : '') +
      '<p class="discussion-body">' +
      esc(item.body ?? removed()) +
      '</p>' +
      (item.tripDay
        ? '<p class="meta">' + t('common.trip_date') + ' · ' + esc(displayDay(item.tripDay)) + '</p>'
        : '') +
      (item.helpful
        ? '<p class="discussion-helpful">' + t('discussion.marked_helpful_by_the_angler_who_asked') + '</p>'
        : ''),
  );
  if (item.replyCount !== undefined) {
    const count = document.createElement('p');
    count.className = 'meta';
    count.textContent = t('discussion.replies') + ' · ' + item.replyCount;
    card.append(count);
  }
  return card;
}

/** Append an actionable control to this post's own button row. */
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
/** @param {import('../../../../types/screens.js').ScreenContext} context */
export async function waterDiscussion({ view, nav, waterDirectory }) {
  const { id, questionId = null } = view.route;
  const water = waterDirectory.byId.get(id);
  if (!water) return nav.back();
  const key = water.key;
  replaceMarkup(
    screen,
    back(t('common.back')) +
      '<div class="page-intro"><p class="meta">' +
      esc(water.name) +
      ' · ' +
      esc(water.number) +
      '</p><h1>' +
      (questionId ? t('discussion.water_post') : questions()) +
      '</h1></div>' +
      '<div id="discussion-root"></div><div class="actions" id="discussion-tools" hidden>' +
      button('discussion-compose', label(questionId ? 'discussion.reply' : 'discussion.compose'), 'primary') +
      button('discussion-refresh', t('common.refresh'), 'secondary') +
      '</div>' +
      '<h2 id="answers-title" hidden>' +
      t('discussion.answers') +
      '</h2><div id="discussion-items"></div>' +
      '<p id="discussion-status" role="status"></p>' +
      button('discussion-more', t('discussion.older_posts'), 'secondary') +
      button('discussion-retry', t('common.retry'), 'secondary') +
      button('discussion-signin', t('common.sign_in'), 'secondary'),
  );
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

  /** Expose only the discussion actions allowed by the server's post state. */
  function makeCard(item, isRoot) {
    const card = postCard(item);
    if (!questionId) {
      action(card, t('discussion.open_post'), () => nav.open('waterDiscussion', { id, questionId: item.id }));
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
            message: t('discussion.your_text_will_be_removed_from_the'),
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
        const privateReply = action(card, t('discussion.reply_privately'), () =>
          nav.open('messageThread', { questionId: item.id }),
        );
        privateReply.id = 'private-reply';
      }
      const flag = action(card, report(), async () => {
        const accepted = await confirmAction({
          title: report() + '?',
          accept: report(),
          message: t('discussion.send_this_post_to_the_pilot_operator'),
        });
        if (accepted && view.active())
          await submitChange(
            view,
            () => rpc('discussion_report', { water_key: key, post_id: item.id }),
            () => {
              item.reported = true;
              flag.disabled = true;
              flag.textContent = t('common.reported');
            },
            failed,
          );
      });
      flag.classList.add('report-post');
      if (item.reported) {
        flag.disabled = true;
        flag.textContent = t('common.reported');
      }
      if (!isRoot && question.mine) {
        const mark = action(
          card,
          item.helpful ? t('discussion.remove_helpful_mark') : t('discussion.mark_helpful'),
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
      const respond = action(card, t('discussion.reply_to_this_post'), () =>
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

  /** Request the next page of this discussion and retire stale screen results. */
  async function loadPage() {
    if (loading || view.saving || !view.active()) return;
    loading = true;
    signIn.hidden = retry.hidden = more.hidden = true;
    status.textContent = t('discussion.loading_discussion');
    try {
      const page = await rpc('water_discussion', {
        water_key: key,
        question_id: questionId,
        before_position: next,
      });
      if (!view.active()) return;
      if (!next) {
        if (questionId && (!page.question || page.question.id !== questionId)) {
          throw Object.assign(new Error('Discussion root unavailable'), { status: 404 });
        }
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
          ? t('discussion.no_answers_yet')
          : t('discussion.no_posts_here_yet');
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
/** @param {import('../../../../types/screens.js').ScreenContext} context */
export function discussionComposer({ view, nav, waterDirectory }) {
  const { id, questionId = null } = view.route;
  const water = waterDirectory.byId.get(id);
  if (!water) return nav.back();
  const publish = questionId ? t('discussion.post_answer') : t('discussion.publish_post');
  replaceMarkup(
    screen,
    back(t('common.back')) +
      '<div class="page-intro"><p class="meta">' +
      esc(water.name) +
      '</p><h1>' +
      (questionId ? t('discussion.answer_at_this_water') : t('discussion.new_post')) +
      '</h1></div>' +
      (questionId
        ? '<blockquote class="discussion-context">' +
          (view.route.replyAuthor
            ? '<strong>' + esc(t('discussion.reply_to') + view.route.replyAuthor) + '</strong><br>'
            : '') +
          esc(view.route.questionText) +
          '</blockquote>'
        : '') +
      '<form id="discussion-form" class="entry-form"><section class="surface">' +
      field(
        'discussion-text',
        questionId ? t('discussion.your_answer') : t('discussion.what_did_you_observe_or_what_would'),
        '<textarea id="discussion-text" rows="5" maxlength="1600" required></textarea>',
      ) +
      (questionId
        ? field(
            'discussion-day',
            t('discussion.trip_date_optional'),
            '<input id="discussion-day" type="date" max="' + esc(today(water.zone)) + '">',
          )
        : '') +
      '<p class="meta">' +
      t('discussion.signed_in_anglers_will_see_this_post') +
      '</p><p id="discussion-error" role="alert"></p></section><div class="savebar"><button type="submit" class="primary">' +
      publish +
      '</button></div></form>',
  );
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
      error.textContent = t('discussion.check_your_text_and_trip_date');
      return;
    }
    const confirmed = await confirmAction({
      title: publish + '?',
      accept: publish,
      message:
        water.name + '\n\n' + message + (day ? '\n\n' + t('common.trip_date') + ' · ' + displayDay(day) : ''),
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
