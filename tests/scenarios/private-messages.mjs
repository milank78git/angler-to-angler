import assert from 'node:assert/strict';
import { messageInbox, messageThread, messageComposer } from '../../app/src/main/assets/messages.js';

const by = (id) => document.getElementById(id);
const confirm = (accepted) => by(accepted ? 'confirmation-accept' : 'confirmation-cancel').click();
const errors = new Map([
  [401, 'messages.sign_in_again_to_use_messages'],
  [403, 'messages.messaging_is_unavailable_for_this_account_or'],
  [404, 'messages.the_question_or_conversation_is_no_longer'],
  [409, 'messages.the_contents_of_the_retried_request_have'],
  [429, 'limits.hourly'],
  [503, 'common.could_not_connect_please_retry'],
]);
const stamp = '2028-02-29T12:30:00Z';

export async function run({ check, words, locale }) {
  // Recover the same cursor after a failed second page without duplicating the first peer.
  for (const [status, key] of errors) {
    for (const unread of [true, false]) {
      await check('inbox/' + status + '/' + unread, async () => {
        const opened = [],
          cursors = [];
        window.Device.profileRequest = (id, op, raw) => {
          assert.equal(op, 'message_inbox');
          const cursor = JSON.parse(raw).before_position;
          cursors.push(cursor);
          if (cursors.length === 2) return window.profileReply(id, status, {});
          window.profileReply(id, 200, {
            items: [
              {
                peerName: cursor ? 'Older' : '<Peer>',
                threadId: cursor ? 'second' : 'first',
                unread: !cursor && unread,
                postedAt: stamp,
              },
            ],
            next: cursor ? null : 'opaque-cursor',
          });
        };
        await messageInbox({ view: { active: () => true }, nav: { open: (...args) => opened.push(args) } });
        const items = by('message-items');
        const time = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(stamp),
        );
        assert.equal(
          items.firstChild.textContent,
          (unread ? words('messages.unread') + ' · ' : '') + '<Peer> · ' + time,
        );
        await by('message-more').onclick();
        assert.equal(items.childElementCount, 1);
        assert.equal(by('message-status').textContent, words(key));
        assert.equal(by('message-retry').hidden, false);
        await by('message-retry').onclick();
        assert.deepEqual(cursors, [null, 'opaque-cursor', 'opaque-cursor']);
        assert.equal(items.childElementCount, 2);
        assert.equal(by('message-more').hidden, true);
        items.lastChild.click();
        assert.deepEqual(opened, [['messageThread', { threadId: 'second' }]]);
      });
    }
  }

  // A receipt, not the HTTP status alone, is what lets the composer discard a private draft.
  for (const source of ['thread', 'question'])
    for (const result of ['cancel', 'blank', 'ok', 'wrong-receipt', 'missing-thread', ...errors.keys()]) {
      await check('compose/' + source + '/' + result, async () => {
        const writes = [],
          opened = [];
        const route = {
          threadId: source === 'thread' ? 'thread1' : null,
          questionId: source === 'question' ? 'q1' : null,
          peerName: '<Peer>',
          questionText: source === 'question' ? '<Question>' : '',
        };
        const view = { route, active: () => true, dirty: true };
        let reply = result;
        window.Device.profileRequest = (id, op, raw) => {
          assert.equal(op, 'message_send');
          const args = JSON.parse(raw);
          writes.push(args);
          window.profileReply(id, typeof reply === 'number' ? reply : 200, {
            threadId: reply === 'missing-thread' ? null : 'delivered',
            requestId: reply === 'wrong-receipt' ? 'different' : args.request_id,
          });
        };
        messageComposer({ view, nav: { backToMessage: (thread) => opened.push(thread) } });
        const editor = by('message-text'),
          send = () => by('message-form').onsubmit(new Event('submit', { cancelable: true }));
        editor.value = result === 'blank' ? '  ' : '  Message <visible>  ';
        const first = send();
        if (result !== 'blank') confirm(result !== 'cancel');
        await first;
        if (result === 'cancel' || result === 'blank') {
          assert.deepEqual(writes, []);
          assert.deepEqual(opened, []);
          assert.equal(view.dirty, true);
          if (result === 'blank')
            assert.equal(by('send-error').textContent, words('messages.enter_a_message'));
          return;
        }
        assert.equal(writes.length, 1);
        assert.equal(writes[0].message, 'Message <visible>');
        assert.equal(writes[0].thread_id, route.threadId);
        assert.equal(writes[0].question_id, route.questionId);
        assert.ok(writes[0].request_id);
        if (result !== 'ok') {
          assert.deepEqual(opened, []);
          assert.equal(view.dirty, true);
          assert.equal(
            by('send-error').textContent,
            words(errors.get(result) ?? 'common.could_not_connect_please_retry'),
          );
          reply = 'ok';
          const retry = send();
          confirm(true);
          await retry;
          assert.deepEqual(writes[1], writes[0]);
        }
        assert.deepEqual(opened, ['delivered']);
        assert.equal(view.dirty, false);
      });
    }

  // Check selection replacement and the real 1600 UTF-16-unit limit, including two-unit emoji.
  for (const [starting, selected, expected] of [
    [1598, 0, true],
    [1599, 0, false],
    [1600, 2, true],
    [1600, 1, false],
  ]) {
    await check('emoji-limit/' + starting + '/' + selected, async () => {
      const view = { route: { peerName: 'Peer' }, active: () => true, dirty: false };
      messageComposer({ view, nav: {} });
      const input = by('message-text'),
        menu = by('inline-emoji');
      input.value = 'a'.repeat(starting);
      input.setSelectionRange(1, 1 + selected);
      menu.open = true;
      menu.querySelector('button').click();
      assert.equal(
        input.value,
        expected ? 'a👍' + 'a'.repeat(starting - selected - 1) : 'a'.repeat(starting),
      );
      assert.equal(view.dirty, expected);
      assert.equal(
        by('send-error').textContent,
        expected ? '' : words('message_emoji.messages_can_contain_up_to_1_600'),
      );
      assert.equal(menu.open, !expected);
    });
  }

  for (const canSend of [false, true])
    for (const previous of [null, '👍'])
      for (const outcome of ['ok', 'invalid-receipt', 'invalid-emoji', 'offline']) {
        if (!canSend && !previous && outcome !== 'ok') continue;
        await check('reaction/' + canSend + '/' + previous + '/' + outcome, async () => {
          const writes = [],
            reads = [];
          window.Device.profileRequest = (id, op, raw) => {
            const args = JSON.parse(raw);
            if (op === 'message_history')
              return window.profileReply(id, 200, {
                threadId: 'thread1',
                peerName: '<Peer>',
                questionText: '<Question>',
                canSend,
                blockedByMe: !canSend,
                items: [
                  {
                    id: 33,
                    body: '<private text>',
                    mine: false,
                    postedAt: stamp,
                    myReaction: previous,
                    peerReaction: '❤️',
                  },
                ],
                next: null,
              });
            if (op === 'message_read') {
              reads.push(args);
              return window.profileReply(id, 200, {});
            }
            assert.equal(op, 'message_react');
            writes.push(args);
            window.profileReply(id, outcome === 'invalid-emoji' ? 400 : outcome === 'offline' ? 503 : 200, {
              myReaction: outcome === 'invalid-receipt' ? '🎣' : args.emoji,
              peerReaction: '❤️',
            });
          };
          const view = { route: { threadId: 'thread1' }, active: () => true };
          await messageThread({ view, nav: {} });
          assert.deepEqual(reads, [{ thread_id: 'thread1', through_position: 33 }]);
          assert.equal(by('message-items').querySelector('.discussion-body').textContent, '<private text>');
          assert.equal(by('write-message').hidden, !canSend);
          const region = by('message-items').querySelector('.message-reactions');
          const summary = () => region.querySelector('[role="status"]').textContent;
          const before = summary();
          assert.ok(before.includes('<Peer> ❤️'));
          let button = region.querySelector('button');
          if (canSend) {
            const menu = region.querySelector('details');
            menu.open = true;
            menu.ontoggle();
            button = menu.querySelector('button');
            assert.equal(button.getAttribute('aria-pressed'), String(Boolean(previous)));
          } else if (!previous) {
            assert.equal(button, null);
            assert.equal(region.querySelector('details'), null);
            assert.deepEqual(writes, []);
            return;
          }
          const emoji = previous ? null : '👍';
          await button.onclick();
          assert.deepEqual(writes, [{ thread_id: 'thread1', message_id: 33, emoji }]);
          if (outcome === 'ok') {
            assert.equal(summary(), (emoji ? words('common.you') + ' 👍 · ' : '') + '<Peer> ❤️');
          } else {
            assert.equal(summary(), before);
            assert.equal(
              region.querySelector('[role="alert"]').textContent,
              words(
                outcome === 'invalid-emoji'
                  ? 'message_emoji.choose_a_single_emoji'
                  : 'common.could_not_connect_please_retry',
              ),
            );
          }
        });
      }
}
