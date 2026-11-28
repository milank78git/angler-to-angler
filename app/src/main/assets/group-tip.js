import { newJournalId } from './journal.js';
import { permittedGroups, rpc } from './profile-api.js';
import { button, by, field, t, toast, writeEntry } from './ui.js';

/** Render a private group recipient selector and an explicit post action. */
export function groupTipControls() {
  return (
    button('tip-groups', t('group_tip.choose_a_fishing_group'), 'secondary') +
    '<section id="tip-destination" hidden>' +
    field('tip-group', t('common.recipient'), '<select id="tip-group"></select>') +
    '<p class="meta">' +
    t('group_tip.group_members_will_see_your_display_name') +
    '</p>' +
    button('tip-post', t('group_tip.post_tip_to_group'), 'primary') +
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
  /** Enable group selection and posting only when a tip and its required destination exist. */
  const sync = () => {
    choose.disabled = loading || !getText();
    post.disabled = !getText() || !select.value;
  };
  /** Show the status of posting the tip to the chosen group. */
  function report(message) {
    feedback.textContent = message;
    feedback.hidden = !message;
  }
  /** Preserve the local draft when the group operation fails. */
  function reportError(error) {
    if (error.status === 429) return report(t('limits.hourly'));
    const message =
      error.status === 401
        ? t('group_tip.sign_in_to_your_account_again_to')
        : error.status === 403
          ? t('group_tip.this_group_is_no_longer_available_choose')
          : t('group_tip.could_not_confirm_the_request_check_your');
    report(message);
  }

  choose.onclick = async () => {
    if (loading || view.saving) return;
    loading = true;
    destination.hidden = true;
    select.replaceChildren(new Option(t('group_tip.select_a_group'), ''));
    sync();
    report(t('group_tip.loading_groups'));
    try {
      // Tip consent is independent of permission to share a catch in the same group.
      const groups = await permittedGroups('canShareTip');
      if (!view.active()) return;
      for (const group of groups) select.add(new Option(group.name, group.id));
      destination.hidden = !groups.length;
      report(groups.length ? '' : t('group_tip.create_a_group_or_join_with_an'));
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
    report(t('group_tip.posting_tip'));
    await writeEntry(
      view,
      nav,
      tripId,
      async () => {
        const receipt = await rpc('group_tip_post', attempt);
        if (receipt.id?.replaceAll('-', '') !== attempt.request_id.replaceAll('-', ''))
          throw Error('Unexpected tip receipt');
        if (view.active()) toast(t('group_tip.tip_posted_to') + name + '.');
      },
      reportError,
    );
  };
  return sync;
}
