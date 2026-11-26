function fold(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '');
}
function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function today(zone, instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type) => parts.find((p) => p.type === type).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}
function inSeason(day, [start, end]) {
  const monthDay = day.slice(5);
  return start <= end ? monthDay >= start && monthDay <= end : monthDay >= start || monthDay <= end;
}

function season(pack, species, section, day) {
  if (!validDay(day) || day < pack.from || day > pack.until) return 'unknown';
  if (section === 'restricted') return 'prohibited';
  if (section !== 'main' || !Object.prototype.hasOwnProperty.call(pack.species, species)) return 'unknown';
  return inSeason(day, pack.species[species].window) ? 'closed' : 'outside';
}
/** Accept only ordinary decimal notation, with either local decimal separator. */
function decimal(value) {
  const text = String(value).trim();
  return /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(text) ? Number(text.replace(',', '.')) : NaN;
}
function point(lat, lon) {
  if (!String(lat).trim() && !String(lon).trim()) return null;
  const a = decimal(lat),
    b = decimal(lon);
  if (!Number.isFinite(a) || Math.abs(a) > 90) throw Error('lat');
  if (!Number.isFinite(b) || Math.abs(b) > 180) throw Error('lon');
  return { lat: a, lon: b };
}
function lengthMm(input) {
  if (!String(input).trim()) return null;
  const cm = decimal(input);
  if (!Number.isFinite(cm) || cm <= 0 || cm > 2500 || Math.round(cm * 10) < 1) throw Error('length');
  return Math.round(cm * 10);
}

export { fold, validDay, today, inSeason, season, point, lengthMm };
