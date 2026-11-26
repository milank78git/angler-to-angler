import { by, t, submitChange } from './ui.js';
import { rpc } from './profile-api.js';

const quickChoices = [
  ['👍', 'emoji.thumbs_up'],
  ['❤️', 'emoji.heart'],
  ['😂', 'emoji.laughter'],
  ['😮', 'emoji.surprise'],
  ['😢', 'emoji.sadness'],
  ['🙏', 'emoji.thanks'],
  ['🎣', 'emoji.fishing'],
  ['🐟', 'emoji.fish'],
];

function control(text, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.onclick = onClick;
  return button;
}

function choices(choose, current) {
  const row = document.createElement('div');
  row.className = 'emoji-choices';
  for (const [glyph, key] of quickChoices) {
    const choice = control(glyph, () => choose(glyph));
    choice.setAttribute('aria-label', t(key));
    if (current !== undefined) choice.setAttribute('aria-pressed', String(current === glyph));
    row.append(choice);
  }
  return row;
}

/** Native keyboard input and quick inserts share the textarea's selection and its length limit. */
export function bindInlineEmoji() {
  const editor = by('message-text');
  const menu = by('inline-emoji');
  menu.append(
    choices((glyph) => {
      const start = editor.selectionStart,
        end = editor.selectionEnd;
      if (editor.value.length - (end - start) + glyph.length > editor.maxLength) {
        by('send-error').textContent = t('message_emoji.messages_can_contain_up_to_1_600');
        return;
      }
      editor.setRangeText(glyph, start, end, 'end');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      by('send-error').textContent = '';
      menu.open = false;
      editor.focus();
    }),
  );
}

/** The server returns both current reactions. Only the caller's slot can be changed by this editor. */
export function messageReactions(view, data, item, explainError) {
  const region = document.createElement('div');
  region.className = 'message-reactions';

  function render(focus) {
    region.replaceChildren();
    const feedback = document.createElement('p');
    feedback.className = 'meta';
    feedback.setAttribute('role', 'status');
    const labels = [];
    if (item.myReaction) labels.push(t('common.you') + ' ' + item.myReaction);
    if (item.peerReaction) labels.push(data.peerName + ' ' + item.peerReaction);
    feedback.textContent = labels.join(' · ');
    const error = document.createElement('p');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    region.append(feedback, error);

    async function save(glyph) {
      error.hidden = true;
      let receipt;
      await submitChange(
        view,
        async () => {
          receipt = await rpc('message_react', {
            thread_id: data.threadId,
            message_id: item.id,
            emoji: glyph,
          });
          if (receipt.myReaction !== glyph) throw Error('Invalid reaction receipt');
        },
        () => {
          item.myReaction = receipt.myReaction;
          item.peerReaction = receipt.peerReaction;
          render(true);
        },
        (err) => {
          error.hidden = false;
          error.textContent =
            err.status === 400 ? t('message_emoji.choose_a_single_emoji') : explainError(err);
        },
      );
    }

    if (!data.canSend) {
      if (item.myReaction) region.append(control(t('message_emoji.remove_my_reaction'), () => save(null)));
      return;
    }

    const menu = document.createElement('details'),
      summary = document.createElement('summary');
    summary.textContent = item.myReaction ? t('message_emoji.change_reaction') : t('message_emoji.react');
    menu.append(summary);
    // Populate only the picker the angler actually opens.
    menu.ontoggle = () => {
      if (!menu.open || menu.childElementCount > 1) return;
      menu.append(
        choices((glyph) => save(item.myReaction === glyph ? null : glyph), item.myReaction || null),
      );
      const label = document.createElement('label'),
        input = document.createElement('input');
      label.textContent = t('message_emoji.another_emoji_from_your_keyboard');
      input.type = 'text';
      input.maxLength = 96;
      input.autocomplete = 'off';
      input.spellcheck = false;
      label.append(input);
      const apply = control(t('message_emoji.use_emoji'), () => {
        const glyph = input.value.trim();
        if (glyph) save(glyph);
        else input.focus();
      });
      input.onkeydown = (event) => {
        if (event.key === 'Enter' && !event.isComposing) {
          event.preventDefault();
          apply.click();
        }
      };
      menu.append(label, apply);
      if (item.myReaction) menu.append(control(t('message_emoji.remove_my_reaction'), () => save(null)));
    };
    region.append(menu);
    if (focus) summary.focus({ preventScroll: true });
  }
  render(false);
  return region;
}
