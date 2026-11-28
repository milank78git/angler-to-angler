// The CDP driver serializes these controls into the installed WebView.
export function webviewControls() {
  const find = (selector) => document.querySelector(selector);
  const shown = (element) => element && !element.closest('[hidden]') && !element.disabled;
  function expect(value, message) {
    if (!value) throw Error(message);
  }
  async function until(read, description) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const value = read();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    const page = find('#screen')?.dataset.page;
    const controls = [...document.querySelectorAll('#screen button[id]')].filter(shown).map((el) => el.id);
    const feedback = [find('#notice')?.textContent, find('#screen [role="alert"]')?.textContent]
      .filter(Boolean)
      .join(' / ');
    throw Error(
      'Waiting for ' +
        description +
        ' on ' +
        page +
        ' (controls: ' +
        controls +
        ', feedback: ' +
        feedback +
        ')',
    );
  }
  async function click(selector) {
    const element = await until(() => shown(find(selector)) && find(selector), selector);
    element.click();
  }
  function set(selector, value) {
    const el = find(selector);
    expect(shown(el), 'Unavailable input ' + selector);
    el.value = value;
    expect(el.value === value, 'Input rejected value for ' + selector);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  }
  async function page(name) {
    await until(
      () => find('#screen').dataset.page === name && !find('#screen').hasAttribute('aria-busy'),
      name,
    );
    expect(!find('#retry'), 'Application could not render ' + name);
  }
  async function confirm(accept) {
    await click('#confirmation[open] ' + (accept ? '#confirmation-accept' : '#confirmation-cancel'));
    await until(() => !find('#confirmation').open, 'confirmation to close');
  }
  return { find, shown, expect, until, click, set, page, confirm };
}
