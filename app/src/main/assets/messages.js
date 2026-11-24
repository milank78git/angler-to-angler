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

const inboxTitle = () => t('Soukromé zprávy', 'Private messages');
const sendLabel = () => t('Odeslat soukromě', 'Send privately');
const stamp = new Intl.DateTimeFormat(languageTag, { dateStyle: 'medium', timeStyle: 'short' });
function errorText(err) {
  if (err.status === 403)
    return t(
      'Zprávy nejsou pro tento účet nebo rozhovor dostupné.',
      'Messaging is unavailable for this account or conversation.',
    );
  if (err.status === 401) return t('Pro zprávy se znovu přihlas.', 'Sign in again to use messages.');
  if (err.status === 404)
    return t('Dotaz nebo rozhovor už není dostupný.', 'The question or conversation is no longer available.');
  if (err.status === 409)
    return t('Obsah opakovaného požadavku se změnil.', 'The contents of the retried request have changed.');
  return t('Připojení se nezdařilo. Zkus to znovu.', 'Could not connect. Please retry.');
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
    status.textContent = t('Načítám…', 'Loading…');
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
    button('message-more', t('Načíst starší', 'Load older'), 'secondary') +
    button('message-retry', t('Zkusit znovu', 'Retry'), 'secondary')
  );
}

export async function messageInbox({ view, nav }) {
  screen.innerHTML =
    back(t('Zpět', 'Back')) +
    '<h1>' +
    inboxTitle() +
    '</h1>' +
    button('inbox-refresh', t('Obnovit', 'Refresh'), 'secondary') +
    listShell();
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
    t(
      'Zatím nemáš žádné soukromé zprávy. Rozhovor můžeš začít u dotazu jiného rybáře.',
      'No private messages yet. Start a conversation from another angler’s question.',
    ),
  );
}

export async function messageThread({ view, nav }) {
  const { threadId = null, questionId = null } = view.route;
  screen.innerHTML =
    back(t('Zpět', 'Back')) +
    '<p class="meta">' +
    inboxTitle() +
    '</p><h1 id="peer-name">' +
    t('Rozhovor', 'Conversation') +
    '</h1><div id="message-context"></div><div id="message-tools" hidden><div class="actions">' +
    button('write-message', t('Napsat zprávu', 'Write a message'), 'primary') +
    button('block-peer', '', 'secondary') +
    button('thread-refresh', t('Obnovit', 'Refresh'), 'secondary') +
    '</div><p id="block-status" role="status"></p></div>' +
    listShell();
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
          by('message-context').innerHTML =
            '<blockquote class="discussion-context">' + esc(data.questionText) + '</blockquote>';
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
        const label = blocked
          ? t('Odblokovat rybáře', 'Unblock angler')
          : t('Zablokovat rybáře', 'Block angler');
        block.textContent = label;
        by('block-status').textContent = data.canSend
          ? ''
          : blocked
            ? t('Tento účet máš zablokovaný.', 'You have blocked this account.')
            : t(
                'Další zprávy v tomto rozhovoru nelze posílat.',
                'New messages cannot be sent in this conversation.',
              );
        block.onclick = async () => {
          const accepted = await confirmAction({
            title: label + '?',
            accept: label,
            destructive: !blocked,
            message:
              data.peerName +
              '\n\n' +
              (blocked
                ? t('Zrušíš svoji blokaci tohoto účtu.', 'Remove your block on this account.')
                : t(
                    'Ani jeden z vás nebude moct posílat další zprávy ani přidávat reakce. Dosavadní rozhovor vám zůstane.',
                    'Neither of you will be able to send new messages or add reactions. Your existing history stays available.',
                  )),
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
        card.innerHTML =
          '<p class="meta">' +
          esc(item.mine ? t('Ty', 'You') : data.peerName) +
          ' · ' +
          esc(stamp.format(new Date(item.postedAt))) +
          '</p>' +
          (item.questionText
            ? '<blockquote class="discussion-context">' + esc(item.questionText) + '</blockquote>'
            : '') +
          '<p class="discussion-body">' +
          esc(item.body) +
          '</p>';
        if (!item.mine) {
          const flag = document.createElement('button');
          flag.type = 'button';
          flag.className = 'secondary';
          const label = t('Nahlásit zprávu', 'Report message'),
            flagged = t('Nahlášeno', 'Reported');
          flag.textContent = item.reported ? flagged : label;
          flag.disabled = item.reported;
          flag.onclick = async () => {
            const accepted = await confirmAction({
              title: label + '?',
              accept: label,
              message:
                t(
                  'Správci předáš ke kontrole tuto zprávu.',
                  'Send this message to the pilot operator for review.',
                ) +
                '\n\n' +
                item.body,
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
    t('Zatím žádné zprávy.', 'No messages yet.'),
  );
}

export function messageComposer({ view, nav }) {
  const { threadId, questionId, peerName, questionText } = view.route;
  screen.innerHTML =
    back(t('Zpět', 'Back')) +
    '<h1>' +
    t('Soukromá zpráva', 'Private message') +
    '</h1><p>' +
    t('Příjemce', 'Recipient') +
    ' · ' +
    esc(peerName) +
    '</p>' +
    (questionText ? '<blockquote class="discussion-context">' + esc(questionText) + '</blockquote>' : '') +
    '<form class="entry-form" id="message-form"><section class="surface">' +
    field(
      'message-text',
      t('Tvoje zpráva', 'Your message'),
      '<textarea id="message-text" rows="5" required maxlength="1600"></textarea>',
    ) +
    '<details id="inline-emoji"><summary>' +
    t('Vložit emoji', 'Insert emoji') +
    '</summary></details>' +
    '<p class="meta">' +
    t(
      'Zprávu uvidíte jen vy dva. Příjemce ji může nahlásit správci.',
      'Only you and the recipient see the message. The recipient can report it to the pilot operator.',
    ) +
    '</p><p role="alert" id="send-error"></p></section><div class="savebar"><button class="primary">' +
    sendLabel() +
    '</button></div></form>';
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
      error.textContent = t('Napiš zprávu.', 'Enter a message.');
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
