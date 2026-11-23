import { newJournalId } from './journal.js';
import { rpc } from './profile-api.js';
import { button, by, field, t, toast, writeEntry } from './ui.js';

export function groupTipControls() {
  return (
    button('tip-groups', t('Vybrat rybářskou partu', 'Choose a fishing group'), 'secondary') +
    '<section id="tip-destination" hidden>' +
    field('tip-group', t('Příjemce', 'Recipient'), '<select id="tip-group"></select>') +
    '<p class="meta">' +
    t(
      'Členové party uvidí tvou přezdívku a text z náhledu. Odchodem z party se tvé tipy smažou.',
      'Group members will see your display name and the previewed text. Leaving the group deletes your tips.',
    ) +
    '</p>' +
    button('tip-post', t('Odeslat tip do party', 'Post tip to group'), 'primary') +
    '</section><p id="tip-feedback" role="status" hidden></p>'
  );
}

/** Keep the composer local until an angler chooses a group and explicitly posts the preview. */
export function bindGroupTip(view, nav, tripId, getText) {
  const choose = by('tip-groups'),
    select = by('tip-group'),
    post = by('tip-post');
  const destination = by('tip-destination'),
    feedback = by('tip-feedback');
  let loading = false,
    attempt;
  const sync = () => {
    choose.disabled = loading || !getText();
    post.disabled = !getText() || !select.value;
  };
  function report(message) {
    feedback.textContent = message;
    feedback.hidden = !message;
  }
  function reportError(error) {
    const message =
      error.status === 401
        ? t(
            'Pro sdílení do party se znovu přihlas k účtu.',
            'Sign in to your account again to post to a group.',
          )
        : error.status === 403
          ? t(
              'Tato parta už není dostupná. Vyber partu znovu.',
              'This group is no longer available. Choose a group again.',
            )
          : t(
              'Ověření se nezdařilo. Zkontroluj připojení a zkus to znovu.',
              'Could not confirm the request. Check your connection and retry.',
            );
    report(message);
  }

  choose.onclick = async () => {
    if (loading || view.saving) return;
    loading = true;
    destination.hidden = true;
    select.replaceChildren(new Option(t('Vyber partu', 'Select a group'), ''));
    sync();
    report(t('Načítám party…', 'Loading groups…'));
    try {
      const { groups } = await rpc('groups');
      if (!view.active()) return;
      for (const group of groups) select.add(new Option(group.name, group.id));
      destination.hidden = !groups.length;
      report(
        groups.length
          ? ''
          : t(
              'Založ partu nebo přijmi pozvánku v nastavení účtu.',
              'Create a group or join with an invitation in account settings.',
            ),
      );
      if (groups.length) select.focus();
    } catch (error) {
      if (view.active()) reportError(error);
    } finally {
      loading = false;
      if (view.active()) sync();
    }
  };
  select.onchange = () => {
    report('');
    sync();
  };
  post.onclick = async () => {
    const group = select.value,
      text = getText();
    if (!group || !text || view.saving || !view.active()) return;
    // Reuse the request ID when the server committed but its reply was lost.
    if (!attempt || attempt.group_id !== group || attempt.message !== text)
      attempt = { group_id: group, message: text, request_id: newJournalId() };
    const name = select.selectedOptions[0].text;
    report(t('Odesílám tip…', 'Posting tip…'));
    await writeEntry(
      view,
      nav,
      tripId,
      async () => {
        const receipt = await rpc('group_tip_post', attempt);
        if (receipt.id?.replaceAll('-', '') !== attempt.request_id.replaceAll('-', ''))
          throw Error('Unexpected tip receipt');
        if (view.active()) toast(t('Tip má parta ', 'Tip posted to ') + name + '.');
      },
      reportError,
    );
  };
  return sync;
}
