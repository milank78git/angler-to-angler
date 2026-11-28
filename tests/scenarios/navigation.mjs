import assert from 'node:assert/strict';
import { Navigation } from '../../app/src/main/assets/navigation.js';

// Each path starts at a real tab and follows actions exposed by its screens. Paths in other tabs must survive Back.
const paths = {
  waters: [
    [],
    ['water'],
    ['water', 'newTrip'],
    ['water', 'waterDiscussion'],
    ['water', 'waterRules'],
    ['marketShelf'],
    ['marketShelf', 'marketEditor'],
    ['marketShelf', 'marketDetail'],
    ['fishCatalogue', 'fishDetail'],
  ],
  rules: [[], ['fishCatalogue'], ['fishCatalogue', 'fishDetail']],
  trips: [
    [],
    ['newTrip'],
    ['journalStatistics'],
    ['trip'],
    ['trip', 'newCatch'],
    ['trip', 'newTrip'],
    ['trip', 'shareCard'],
    ['trip', 'publicCardEditor'],
    ['trip', 'activityContribution'],
  ],
};
const tabs = Object.keys(paths);
const editors = new Set(['newTrip', 'newCatch', 'marketEditor']);
const top = (tab, history) => history[tab].at(-1) ?? tab;

export async function run({ check }) {
  for (const waters of paths.waters)
    for (const rules of paths.rules)
      for (const trips of paths.trips) {
        const history = { waters, rules, trips };
        for (const active of tabs) {
          const page = top(active, history);
          const states = editors.has(page)
            ? ['clean', 'keep', 'discard', 'saving', 'save-during-prompt']
            : ['clean'];
          for (const state of states)
            for (const action of [...tabs, 'back']) {
              await check(
                `${tabs.map((tab) => [tab, ...history[tab]].join('>')).join('|')}/${active}/${state}/${action}`,
                async () => {
                  let confirm,
                    prompts = 0,
                    disposals = 0;
                  const nav = new Navigation(
                    () => {},
                    () => {
                      prompts++;
                      return new Promise((resolve) => {
                        confirm = resolve;
                      });
                    },
                  );
                  nav.show();
                  // Open the active tab last so selecting a tab root never truncates the history being prepared.
                  for (const tab of [...tabs.filter((tab) => tab !== active), active]) {
                    nav.open(tab);
                    for (const destination of history[tab]) nav.open(destination);
                  }
                  const original = nav.current;
                  assert.equal(original.route.page, page);
                  original.dispose = () => {
                    disposals++;
                  };
                  original.dirty = state !== 'clean';
                  original.saving = state === 'saving';
                  const handled = action === 'back' ? nav.back() : nav.open(action);
                  assert.equal(prompts, Number(['keep', 'discard', 'save-during-prompt'].includes(state)));
                  if (confirm) {
                    assert.equal(nav.current, original);
                    if (state === 'save-during-prompt') original.saving = true;
                    confirm(state !== 'keep');
                    await Promise.resolve();
                  }
                  const blocked = ['keep', 'saving', 'save-during-prompt'].includes(state);
                  const exitsApp = action === 'back' && active === 'waters' && !waters.length;
                  const expected = structuredClone(history);
                  let tab = active;
                  if (!blocked) {
                    if (action === 'back') {
                      if (expected[active].length) expected[active].pop();
                      else tab = 'waters';
                    } else {
                      tab = action;
                      if (tab === active) expected[tab] = [];
                      else if (state === 'discard') expected[active].pop();
                    }
                  }
                  if (action === 'back') assert.equal(handled, !exitsApp);
                  assert.equal(nav.area, tab);
                  assert.equal(nav.current.route.page, top(tab, expected));
                  assert.equal(original.active(), blocked || exitsApp);
                  assert.equal(disposals, Number(!blocked && !exitsApp));
                  // Check dormant stacks too: a corruption there is only visible on the next tab switch.
                  for (const name of tabs)
                    assert.deepEqual(
                      nav.stacks.get(name).map((route) => route.page),
                      [name, ...expected[name]],
                    );
                },
              );
            }
        }
      }
}
