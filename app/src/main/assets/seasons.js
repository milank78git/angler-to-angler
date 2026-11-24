import { languageTag } from './i18n.js';
import * as Domain from './domain.js';
import {
  by,
  screen,
  t,
  loc,
  esc,
  selectField,
  button,
  icon,
  back,
  bindBack,
  bind,
  link,
  displayDay,
} from './ui.js';
function ruleResult(pack, w) {
  const section = by('section').value,
    speciesId = by('species').value,
    day = by('rule-date').value;
  const status = Domain.season(pack, speciesId, section, day);
  const labels = {
    closed: t('Ryba je hájená', 'Closed season'),
    outside: t('Mimo uvedenou dobu hájení', 'Outside the listed closed season'),
    unknown: t('Pro tuto volbu chybí ověřené pravidlo', 'No verified rule for this selection'),
    prohibited: t('V tomto úseku je lov zakázán', 'Fishing is prohibited in this section'),
  };
  const valid = status === 'closed' || status === 'outside';
  const windowLabel = pack.species[speciesId].window
    .map((d) =>
      new Intl.DateTimeFormat(languageTag, {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      }).format(new Date('2000-' + d + 'T12:00Z')),
    )
    .join(' – ');
  const glyph = {
    closed: 'calendar-off',
    prohibited: 'ban',
    unknown: 'circle-help',
    outside: 'calendar-days',
  }[status];
  const minimum = w.size[speciesId]
    ? ' · ' + t('nejmenší míra', 'minimum size') + ' ' + w.size[speciesId] + ' cm'
    : '';
  by('status').innerHTML =
    `<div class="panel result ${status}"><strong>${icon(glyph)}${labels[status]}</strong>
    ${valid ? `<p>${windowLabel}${minimum}</p>` : ''}</div>`;
  const key = pack.id + '/' + w.id + '/' + speciesId;
  by('watch').innerHTML = '';
  if (!window.Device || section !== 'main') return;
  const watching = Device.watching(key),
    today = Domain.today(pack.zone);
  if (!watching && (today > pack.until || today < pack.from)) return;
  by('watch').innerHTML =
    button(
      'watch-toggle',
      watching
        ? t('Vypnout připomínky', 'Stop reminders')
        : t('Připomínat změny hájení', 'Remind me of season changes'),
    ) +
    '<p class="meta">' +
    t(
      'Pro hlavní tok. Telefon připomene také konec platnosti podkladů.',
      'For the main river. Includes a reminder when the local rules pack expires.',
    ) +
    '</p>';
  bind('watch-toggle', () => Device.reminder(key, !watching));
}
export function rulesScreen(context) {
  const { view, pack, nav } = context;
  const { route } = view;
  const w = pack.waters.find((x) => x.id === route.id) || pack.waters[0],
    contextual = route.page === 'waterRules';
  route.id = w.id;
  const species = Object.entries(pack.species).map(([key, v]) => [key, loc(v)]);
  screen.innerHTML =
    (contextual ? back(w.name) : '') +
    `<div class="page-intro"><div class="title-mark">${icon('calendar-days')}</div><h1>${t('Hájení a míry', 'Seasons & sizes')}</h1></div><div class="columns"><section class="surface">
    ${selectField(
      'rule-water',
      t('Revír', 'Water'),
      pack.waters.map((v) => [v.id, v.name]),
      w.id,
    )}
    ${selectField(
      'section',
      t('Úsek', 'Section'),
      [
        ['main', t('Hlavní tok', 'Main river')],
        ['restricted', loc(w.restriction)],
        ['other', t('Jiný úsek / přítok', 'Other section / tributary')],
      ],
      route.section || 'main',
    )}
    <div class="pair"><div>${selectField('species', t('Druh ryby', 'Fish species'), species, route.species || species[0][0])}</div><div><label for="rule-date">${t('Datum lovu', 'Fishing date')}</label><input id="rule-date" type="date" value="${esc(route.day ?? Domain.today(pack.zone))}"></div></div></section>
    <div><div id="status" aria-live="polite"></div><div id="watch"></div></div></div>
    <details class="fold"><summary>${icon('info')}${t('Platnost a zdroje', 'Coverage and sources')}</summary><div class="fold-body"><p>${t('Zobrazené pravidlo pokrývá vybraný druh a úsek. Ověř si i další místní omezení.', 'The selected rule covers this species and section. Check other local restrictions.')}</p><p class="sub">${t('Ověřeno', 'Checked')} ${esc(displayDay(pack.revision))} · ${t('Platí do', 'Valid through')} ${esc(displayDay(pack.until))}</p><div class="rulesrc">${link(w.source, t('Karta revíru ČRS', 'Fishery authority'))}${link(pack.law, t('Vyhláška · § 13', 'National closed seasons'))}</div></div></details>`;
  if (contextual) {
    bindBack(nav);
    by('rule-water').disabled = true;
  }
  by('rule-water').onchange = async () => {
    route.id = by('rule-water').value;
    route.section = 'main';
    await nav.show();
    if (nav.current.route === route) by('rule-water')?.focus();
  };
  for (const key of ['section', 'species', 'rule-date'])
    by(key).onchange = () => {
      route.section = by('section').value;
      route.species = by('species').value;
      route.day = by('rule-date').value;
      ruleResult(pack, w);
    };
  const refresh = () => ruleResult(pack, w);
  window.addEventListener('reminderchange', refresh);
  view.dispose = () => window.removeEventListener('reminderchange', refresh);
  ruleResult(pack, w);
}
