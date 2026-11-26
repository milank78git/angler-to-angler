import { replaceMarkup } from './markup.js';
import { languageTag } from './i18n.js';
import { bindInlineEmoji, messageReactions } from './message-emoji.js';
import { newJournalId } from './journal.js';
import { rpc } from './profile-api.js';
import {
  back,
  bind,
  bindBack,
  button,
  by,
  confirmAction,
  esc,
  field,
  screen,
  submitChange,
  t,
  toast,
  trackEdits,
} from './ui.js';

const inboxTitle = () => t('common.private_messages');
const sendLabel = () => t('messages.send_privately');
const stamp = new Intl.DateTimeFormat(languageTag, { dateStyle: 'medium', timeStyle: 'short' });
function errorText(err) {
  if (err.status === 403) return t('messages.messaging_is_unavailable_for_this_account_or');
  if (err.status === 401) return t('messages.sign_in_again_to_use_messages');
  if (err.status === 404) return t('messages.the_question_or_conversation_is_no_longer');
  if (err.status === 409) return t('messages.the_contents_of_the_retried_request_have');
  return t('common.could_not_connect_please_retry');
}

// Both lists use a server cursor. A failed page keeps the entries already rendered.
async function listPages(view, read, render, empty) {
  const status = by('message-status'),
    more = by('message-more'),
    retry = by('message-retry'),
    items = by('message-items');
  let next = null,
    loading = false;
  async function load() {
    if (loading || view.saving || !view.active()) return;
    loading = true;
    retry.hidden = more.hidden = true;
    status.textContent = t('messages.loading');
    try {
      const data = await read(next);
      if (!view.active()) return;
      render(data, !next);
      next = data.next;
      more.hidden = !next;
      status.textContent = items.childElementCount ? '' : empty;
    } catch (err) {
      if (view.active()) {
        status.textContent = errorText(err);
        retry.hidden = false;
      }
    } finally {
      loading = false;
    }
  }
  more.onclick = retry.onclick = load;
  await load();
}

function listShell() {
  return (
    '<div id="message-items"></div><p id="message-status" role="status"></p>' +
    button('message-more', t('messages.load_older'), 'secondary') +
    button('message-retry', t('common.retry'), 'secondary')
  );
}

/** @param {import('../../../../types/screens.js').ScreenContext} context */
export async function messageInbox({ view, nav }) {
  replaceMarkup(
    screen,
    back(t('common.back')) +
      '<h1>' +
      inboxTitle() +
      '</h1>' +
      button('inbox-refresh', t('common.refresh'), 'secondary') +
      listShell(),
  );
  bindBack(nav);
  bind('inbox-refresh', () => nav.show());
  await listPages(
    view,
    (before_position) => rpc('message_inbox', { before_position }),
    (data) => {
      for (const item of data.items) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'secondary';
        row.textContent = item.peerName + ' · ' + stamp.format(new Date(item.postedAt));
        row.onclick = () => nav.open('messageThread', { threadId: item.threadId });
        by('message-items').append(row);
      }
    },
    t('messages.no_private_messages_yet_start_a_conversation'),
  );
}

/** @param {import('../../../../types/screens.js').ScreenContext} context */
export async function messageThread({ view, nav }) {
  const { threadId = null, questionId = null } = view.route;
  replaceMarkup(
    screen,
    back(t('common.back')) +
      '<p class="meta">' +
      inboxTitle() +
      '</p><h1 id="peer-name">' +
      t('messages.conversation') +
      '</h1><div id="message-context"></div><div id="message-tools" hidden><div class="actions">' +
      button('write-message', t('messages.write_a_message'), 'primary') +
      button('block-peer', '', 'secondary') +
      button('thread-refresh', t('common.refresh'), 'secondary') +
      '</div><p id="block-status" role="status"></p></div>' +
      listShell(),
  );
  bindBack(nav);
  bind('thread-refresh', () => nav.show());
  const read = (before_position) =>
    rpc('message_history', { thread_id: threadId, question_id: questionId, before_position });
  await listPages(
    view,
    read,
    (data, first) => {
      if (first) {
        by('peer-name').textContent = data.peerName;
        by('message-tools').hidden = false;
        if (data.questionText)
          replaceMarkup(
            by('message-context'),
            '<blockquote class="discussion-context">' + esc(data.questionText) + '</blockquote>',
          );
        by('write-message').hidden = !data.canSend;
        bind('write-message', () =>
          nav.open('messageComposer', {
            threadId,
            questionId,
            peerName: data.peerName,
            questionText: data.questionText,
          }),
        );
        const block = by('block-peer'),
          blocked = data.blockedByMe;
        block.hidden = !data.threadId;
        const label = blocked ? t('messages.unblock_angler') : t('messages.block_angler');
        block.textContent = label;
        by('block-status').textContent = data.canSend
          ? ''
          : blocked
            ? t('messages.you_have_blocked_this_account')
            : t('messages.new_messages_cannot_be_sent_in_this');
        block.onclick = async () => {
          const accepted = await confirmAction({
            title: label + '?',
            accept: label,
            destructive: !blocked,
            message:
              data.peerName +
              '\n\n' +
              (blocked
                ? t('messages.remove_your_block_on_this_account')
                : t('messages.neither_of_you_will_be_able_to')),
          });
          if (accepted && view.active())
            await submitChange(
              view,
              () => rpc('message_block', { thread_id: data.threadId, blocked: !blocked }),
              () => nav.show(),
              (err) => toast(errorText(err)),
            );
        };
      }
      for (const item of data.items) {
        const card = document.createElement('article');
        card.className = 'surface discussion-post';
        replaceMarkup(
          card,
          '<p class="meta">' +
            esc(item.mine ? t('common.you') : data.peerName) +
            ' · ' +
            esc(stamp.format(new Date(item.postedAt))) +
            '</p>' +
            (item.questionText
              ? '<blockquote class="discussion-context">' + esc(item.questionText) + '</blockquote>'
              : '') +
            '<p class="discussion-body">' +
            esc(item.body) +
            '</p>',
        );
        if (!item.mine) {
          const flag = document.createElement('button');
          flag.type = 'button';
          flag.className = 'secondary';
          const label = t('messages.report_message'),
            flagged = t('common.reported');
          flag.textContent = item.reported ? flagged : label;
          flag.disabled = item.reported;
          flag.onclick = async () => {
            const accepted = await confirmAction({
              title: label + '?',
              accept: label,
              message: t('messages.send_this_message_to_the_pilot_operator') + '\n\n' + item.body,
            });
            if (accepted && view.active())
              await submitChange(
                view,
                () => rpc('message_report', { thread_id: data.threadId, message_id: item.id }),
                () => {
                  flag.disabled = true;
                  flag.textContent = flagged;
                },
                (err) => toast(errorText(err)),
              );
          };
          flag.classList.add('report-message');
          card.append(flag);
        }
        card.append(messageReactions(view, data, item, errorText));
        by('message-items').append(card);
      }
    },
    t('messages.no_messages_yet'),
  );
}

/** @param {import('../../../../types/screens.js').ScreenContext} context */
export function messageComposer({ view, nav }) {
  const { threadId, questionId, peerName, questionText } = view.route;
  replaceMarkup(
    screen,
    back(t('common.back')) +
      '<h1>' +
      t('messages.private_message') +
      '</h1><p>' +
      t('common.recipient') +
      ' · ' +
      esc(peerName) +
      '</p>' +
      (questionText ? '<blockquote class="discussion-context">' + esc(questionText) + '</blockquote>' : '') +
      '<form class="entry-form" id="message-form"><section class="surface">' +
      field(
        'message-text',
        t('messages.your_message'),
        '<textarea id="message-text" rows="5" required maxlength="1600"></textarea>',
      ) +
      '<details id="inline-emoji"><summary>' +
      t('messages.insert_emoji') +
      '</summary></details>' +
      '<p class="meta">' +
      t('messages.only_you_and_the_recipient_see_the') +
      '</p><p role="alert" id="send-error"></p></section><div class="savebar"><button class="primary">' +
      sendLabel() +
      '</button></div></form>',
  );
  bindBack(nav);
  const form = by('message-form');
  bindInlineEmoji();
  trackEdits(form, view);
  let attempt;
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (view.saving || !view.active()) return;
    const message = by('message-text').value.trim(),
      error = by('send-error');
    if (!message) {
      error.textContent = t('messages.enter_a_message');
      return;
    }
    const accepted = await confirmAction({
      title: sendLabel() + '?',
      accept: sendLabel(),
      message: peerName + '\n\n' + message,
    });
    if (!accepted || !view.active()) return;
    if (attempt?.message !== message)
      attempt = { thread_id: threadId, question_id: questionId, request_id: newJournalId(), message };
    error.textContent = '';
    let sentThreadId;
    await submitChange(
      view,
      async () => {
        const receipt = await rpc('message_send', attempt);
        if (
          !receipt.threadId ||
          receipt.requestId?.replaceAll('-', '') !== attempt.request_id.replaceAll('-', '')
        )
          throw Error('Invalid message receipt');
        // The first reply now has a durable inbox thread even if the question is withdrawn.
        sentThreadId = receipt.threadId;
      },
      () => {
        view.dirty = false;
        nav.backToMessage(sentThreadId);
      },
      (err) => {
        error.textContent = errorText(err);
      },
    );
  };
}
