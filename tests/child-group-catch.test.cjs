const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

test('the group catch form sends only previewed fields to an explicitly selected eligible group', async (t) => {
  const dom = new JSDOM(fs.readFileSync('app/src/main/assets/index.html', 'utf8'));
  global.window = dom.window;
  global.document = window.document;
  global.Option = window.Option;
  const by = id => document.getElementById(id);
  const dialog = by('confirmation');
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
  t.mock.timers.enable({apis: ['setTimeout']});
  t.after(() => { dom.window.close(); delete global.window; delete global.document; delete global.Option; });
  const sent = [];
  let granted = false;
  window.Device = { groupSharingOnly: () => true, profileRequest(id, op, raw) {
    const args = JSON.parse(raw);
    let result;
    if (op === 'groups') result = {groups: [{id: 'private', name: 'River crew', canShareCatch: granted},
                                            {id: 'other', name: 'Elsewhere', canShareCatch: false}]};
    else {
      assert.equal(op, 'group_catch_post');
      sent.push(args);
      result = {id: args.request_id};
    }
    queueMicrotask(() => window.profileReply(id, 200, result));
  }};
  const { groupCatch } = await import('../app/src/main/assets/group-catch.js');
  const trip = {day: '2024-03-12', notes: 'private notes', lat: 49, lon: 14};
  const fish = {id: 'local-catch', lengthMm: 320, hasPhoto: false};
  const render = () => groupCatch({active: () => true}, {back() {}}, trip, fish, 'Perch');
  await render();
  assert.equal(by('send-group-catch'), null);
  granted = true;
  await render();
  const picker = by('catch-group');
  assert.deepEqual(Array.from(picker.options, item => item.value), ['', 'private']);
  assert.equal(by('send-group-catch').disabled, true);
  picker.value = 'private'; picker.onchange();
  let click = by('send-group-catch').onclick();
  by('confirmation-cancel').click();
  await click;
  assert.equal(sent.length, 0);
  click = by('send-group-catch').onclick();
  by('confirmation-accept').click();
  await click;
  assert.equal(sent.length, 1);
  const {request_id, ...fields} = sent[0];
  assert.ok(request_id);
  assert.deepEqual(fields, {group_id: 'private', day: trip.day, species: 'Perch', length_mm: 320, photo: null});

  // A restored client and the service can briefly have different age information.
  // Check the old membership shape as well as an explicit denial on the same response.
  for (const [ageBand, eligible] of [['child', false], ['adult', true]]) {
    await t.test('server age band ' + ageBand + ' with a legacy membership', async () => {
      window.Device.groupSharingOnly = () => false;
      window.Device.profileRequest = (id, op) => {
        assert.equal(op, 'groups');
        queueMicrotask(() => window.profileReply(id, 200, {ageBand, groups: [
          {id: 'previous', name: 'Returning group'},
          {id: 'blocked', name: 'Not permitted', canShareCatch: false},
        ]}));
      };
      await render();
      const recipients = by('catch-group');
      if (eligible) assert.deepEqual(Array.from(recipients.options, option => option.value), ['', 'previous']);
      else assert.equal(recipients, null);
    });
  }
});
