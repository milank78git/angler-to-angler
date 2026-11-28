import assert from 'node:assert/strict';
import {localSeasonHtml} from '../../app/src/main/assets/seasons.js';

// Deliberately synthetic seasons give a stable oracle independent of imported legal data, annual updates and today's date.
const species = {summer: {window:['04-01','06-30']}, winter: {window:['11-01','02-29']}};
const pack = {from:'2027-01-01', until:'2028-12-31', species};
const dates = [
  ['2026-12-31', null, null], ['2027-02-29', null, null], ['2027-01-01', false, true],
  ['2028-02-29', false, true], ['2028-03-01', false, false], ['2028-03-31', false, false],
  ['2028-04-01', true, false], ['2028-06-30', true, false], ['2028-07-01', false, false],
  ['2028-10-31', false, false], ['2028-11-01', false, true], ['2028-12-31', false, true], ['2029-01-01', null, null],
];
const labels = {outside:'seasons.outside_the_listed_closed_season', closed:'seasons.closed_season',
  unknown:'seasons.no_verified_rule_for_this_selection', prohibited:'seasons.fishing_is_prohibited_in_this_section'};
export async function run({check, words}) {
  const host = document.createElement('div');
  for (const [date, summer, winter] of dates) for (const [id, closed] of Object.entries({summer, winter})) {
    for (const section of ['main','restricted','other']) await check(`${id}/${section}/${date}`, () => {
      const status = closed == null || section === 'other' ? 'unknown' : section === 'restricted' ? 'prohibited' : closed ? 'closed' : 'outside';
      host.innerHTML = localSeasonHtml(pack, {size:{summer:42,winter:53}}, section, id, date);
      assert.equal(host.querySelector('.result').classList.contains(status), true);
      assert.equal(host.querySelector('strong').textContent, words(labels[status]));
      if (status === 'closed' || status === 'outside') {
        assert.ok(host.querySelector('p').textContent.includes(`${words('seasons.minimum_size')} ${id === 'summer' ? 42 : 53} cm`));
      } else assert.equal(host.querySelector('p'), null);
    });
  }
}
