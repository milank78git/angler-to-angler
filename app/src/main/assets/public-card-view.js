/** Render the same allowlisted document in the journal preview and the anonymous reader. */
export function renderPublicCard(host, card, locale) {
  const cz = locale.toLowerCase().startsWith('cs');
  const words = (cs, en) => cz ? cs : en;
  const make = (tag, text) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const article = make('article');
  article.className = 'public-catch';
  if (card.photo) {
    const photo = make('img');
    photo.src = 'data:image/webp;base64,' + card.photo;
    photo.alt = card.species;
    article.append(photo);
  }
  const body = make('div');
  body.className = 'public-catch-body';
  const heading = make('h2', card.species);
  const author = make('p', card.name);
  author.className = 'public-catch-author';
  body.append(heading, author);
  const details = make('dl');
  const row = (label, element) => {
    const value = make('dd');
    value.append(element);
    details.append(make('dt',label),value);
  };
  const monthOnly = card.precision === 'month';
  const date = new Date(card.date + (monthOnly ? '-01' : '') + 'T12:00:00Z');
  const time = make('time', new Intl.DateTimeFormat(cz ? 'cs-CZ' : 'en-GB',
    {year:'numeric',month:'long',day:monthOnly ? undefined : 'numeric',timeZone:'UTC'}).format(date));
  time.dateTime = card.date;
  row(monthOnly ? words('Měsíc úlovku','Catch month') : words('Datum úlovku','Catch date'), time);
  if (card.water) row(words('Revír','Water'),card.water);
  if (card.length) {
    const measured = card.length.kind === 'measured';
    row(measured ? words('Délka podle měřidla','Length from ruler') : words('Odhad podle reference','Reference-based estimate'),
      new Intl.NumberFormat(cz ? 'cs-CZ' : 'en-GB').format(card.length.mm / 10) + ' cm');
  }
  body.append(details);
  article.append(body);
  host.replaceChildren(article);
}
