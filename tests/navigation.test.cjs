const test = require('node:test');
const assert = require('node:assert/strict');
const { Navigation } = require('../app/src/main/assets/navigation.js');

test('dirty edits require confirmation, and a pending write always consumes Back', () => {
  let discard = false,
    prompts = 0;
  const nav = new Navigation(
    () => {},
    () => {
      prompts++;
      return discard;
    },
  );
  nav.show();
  nav.open('trips');
  nav.open('newTrip');
  const form = nav.current;
  form.dirty = true;
  assert.equal(nav.back(), true);
  assert.equal(prompts, 1);
  assert.equal(nav.current, form);
  form.saving = true;
  discard = true;
  assert.equal(nav.back(), true);
  nav.open('rules');
  assert.equal(prompts, 1);
  assert.equal(nav.current, form);
  form.saving = false;
  nav.open('rules');
  nav.open('trips');
  assert.equal(nav.current.route.page, 'trips');
  assert.equal(form.active(), false);
});

test('successful journal writes retire the form and restore the water context in its own tab', () => {
  const nav = new Navigation(
    () => {},
    () => true,
    () => 42,
  );
  nav.show();
  nav.open('water', { id: '401009' });
  const water = nav.current;
  let retired = 0;
  water.dispose = () => {
    retired++;
  };
  nav.open('newTrip', { water: '401009' });
  assert.equal(retired, 1);
  const oldForm = nav.current;
  nav.journalAfterWrite('t1');
  assert.deepEqual(nav.current.route, { page: 'trip', id: 't1' });
  assert.equal(oldForm.active(), false);
  nav.open('waters');
  assert.equal(nav.current.route, water.route);
  assert.equal(nav.current.route.scroll, 42);
  nav.open('trips');
  nav.open('newCatch', { id: 't1' });
  nav.journalAfterWrite('t1');
  nav.back();
  assert.equal(nav.current.route.page, 'trips');
  nav.open('trip', { id: 't1' });
  nav.journalAfterWrite(null);
  nav.back();
  assert.equal(nav.area, 'waters');
  nav.back();
  assert.equal(nav.back(), false);
});
