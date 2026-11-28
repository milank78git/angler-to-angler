/** @type {{close(): boolean, dispose(): void} | undefined} */
let currentControls;

/** Let Android Back dismiss the diary disclosure before changing the current destination. */
export function dismissJournalControls() {
  return currentControls?.close() || false;
}

/** Keep the diary's status and action disclosures exclusive and retire every screen listener.
 * @param {HTMLElement} root
 */
export function bindJournalControls(root) {
  currentControls?.dispose();
  const owner = root.ownerDocument;
  const entries = Array.from(root.querySelectorAll('button[aria-controls]'))
    .map((element) => ({
      trigger: /** @type {HTMLButtonElement} */ (element),
      panel: /** @type {HTMLElement | null} */ (owner.getElementById(element.getAttribute('aria-controls'))),
    }))
    .filter((entry) => entry.panel && root.contains(entry.panel));
  let opened;
  let disposed = false;

  /** Hide the open disclosure and optionally return keyboard focus to its visible trigger. */
  function hide(restoreFocus) {
    if (!opened) return false;
    const entry = opened;
    opened = undefined;
    entry.panel.hidden = true;
    entry.trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus && entry.trigger.isConnected && !entry.trigger.hidden)
      entry.trigger.focus({ preventScroll: true });
    return true;
  }

  /** Open one disclosure without replacing its nodes or starting synchronization. */
  function show(entry) {
    if (disposed || !root.isConnected || entry.trigger.hidden || entry.trigger.disabled) return;
    hide(false);
    opened = entry;
    entry.panel.hidden = false;
    entry.trigger.setAttribute('aria-expanded', 'true');
  }

  /** Delegate the two disclosure triggers and the visible recovery notice within this header. */
  function activate(event) {
    const entry = entries.find(({ trigger }) => trigger.contains(event.target));
    if (entry) {
      if (entry === opened) hide(true);
      else show(entry);
      return;
    }
    const notice = root.querySelector('#journal-sync-notice');
    if (notice?.contains(event.target)) {
      const sync = entries.find(({ trigger }) => trigger.id === 'journal-sync-toggle');
      if (sync && opened !== sync) show(sync);
    }
  }

  /** Close on an outside tap without redirecting focus away from the tapped control. */
  function outside(event) {
    // A confirmation click may already have closed its dialog before it reaches this listener.
    if (event.target instanceof owner.defaultView.Element && event.target.closest('dialog')) return;
    if (!root.contains(event.target)) hide(false);
  }

  /** Leave modal Escape handling to the active confirmation or help dialog. */
  function escape(event) {
    if (event.key !== 'Escape' || event.defaultPrevented || owner.querySelector('dialog[open]')) return;
    if (hide(true)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  const controls = {
    /** Consume one Back action only while this screen owns an open disclosure. */
    close: () => hide(true),
    /** Retire document listeners before another journal view can claim the controls. */
    dispose() {
      if (disposed) return;
      disposed = true;
      hide(false);
      root.removeEventListener('click', activate);
      owner.removeEventListener('click', outside);
      owner.removeEventListener('keydown', escape);
      if (currentControls === controls) currentControls = undefined;
    },
  };
  for (const { trigger, panel } of entries) {
    trigger.setAttribute('aria-expanded', 'false');
    panel.hidden = true;
  }
  root.addEventListener('click', activate);
  owner.addEventListener('click', outside);
  owner.addEventListener('keydown', escape);
  currentControls = controls;
  return controls;
}
