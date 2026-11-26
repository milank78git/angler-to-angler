/** Platform-independent transfer format. Hashes cover the exact bytes restored on another device. */
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
function toBase64(bytes) {
  let value = '';
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}
const fromBase64 = (data) => Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
const hash = async (bytes) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
const photoData = async (blob) =>
  blob ? { type: blob.type, data: toBase64(new Uint8Array(await blob.arrayBuffer())) } : null;
const photoBlob = (photo) => (photo ? new Blob([fromBase64(photo.data)], { type: photo.type }) : null);

export function preferenceKey(key, subject) {
  if (key.startsWith('water.' + subject + '.')) return 'water/' + key.slice(subject.length + 7);
  if (key === 'atlas.country.' + subject) return 'country';
  if (['ui.theme', 'fish.country', 'atlas.topographic'].includes(key)) return key;
  return null;
}
function localKey(key, subject) {
  if (key.startsWith('water/')) return 'water.' + subject + '.' + key.slice(6);
  if (key === 'country') return 'atlas.country.' + subject;
  return ['ui.theme', 'fish.country', 'atlas.topographic'].includes(key) ? key : null;
}
export async function documentKeys(db, storage, subject) {
  const keys = (await db.tripKeys()).map((id) => 'trip/' + id);
  for (const [, id] of await db.waterPhotoKeys()) keys.push('photo/' + id);
  for (let n = 0; n < storage.length; n++) {
    const pref = preferenceKey(storage.key(n), subject);
    if (pref) keys.push('pref/' + pref);
  }
  return keys;
}
export async function encodeDocument(db, storage, subject, key) {
  let value;
  if (key.startsWith('trip/')) {
    const id = key.slice(5),
      trip = await db.trip(id);
    if (trip) {
      const catches = [];
      for (const record of await db.catches(id))
        catches.push({ record, photo: await photoData(await db.photo(record.id)) });
      value = { trip, catches };
    }
  } else if (key.startsWith('photo/')) value = await photoData(await db.waterPhoto(key.slice(6)));
  else {
    const k = localKey(key.slice(5), subject);
    if (k) value = storage.getItem(k);
  }
  const hashes = [],
    blocks = new Map();
  if (value != null) {
    const bytes = encoder.encode(JSON.stringify({ version: 1, value }));
    if (bytes.length > 1024 * 65536) throw Object.assign(Error('Document too large'), { status: 413 });
    for (let i = 0; i < bytes.length; i += 65536) {
      const part = bytes.subarray(i, i + 65536),
        digest = await hash(part);
      hashes.push(digest);
      blocks.set(digest, part);
    }
  }
  return { hashes, blocks };
}
/** Read a committed digest for comparisons. Materialize bytes only for dirty documents or an upload. */
export async function localDocument(db, storage, subject, key, needBlocks = false) {
  if (key.startsWith('pref/')) return encodeDocument(db, storage, subject, key);
  const cached = await db.fingerprint(key);
  if (cached?.hashes && !needBlocks) return { hashes: cached.hashes };
  const local = await encodeDocument(db, storage, subject, key);
  if (!(await db.cacheHashes(key, cached?.version, local.hashes)))
    throw Object.assign(Error('Journal changed during encoding'), { status: 409 });
  return local;
}

export async function uploadDocument(call, key, local, revision, floor = 0) {
  if (local.hashes.length) {
    const { hashes } = await call('missing', { hashes: [...local.blocks.keys()] });
    for (const h of hashes) await call('put', { hash: h, data: toBase64(local.blocks.get(h)) });
  }
  return (await call('save', { key, revision, floor, parts: local.hashes })).revision;
}
export async function downloadDocument(call, hashes) {
  if (!hashes.length) return null;
  const chunks = [];
  for (const h of hashes) {
    const bytes = fromBase64((await call('get', { hash: h })).data);
    if ((await hash(bytes)) !== h) throw Error('Invalid journal digest');
    chunks.push(bytes);
  }
  const value = JSON.parse(decoder.decode(await new Blob(chunks).arrayBuffer()));
  if (value.version !== 1) throw Error('Unsupported journal version');
  return value.value;
}
export async function restoreDocument(db, storage, subject, key, value) {
  if (key.startsWith('trip/')) {
    const id = key.slice(5);
    if (
      value &&
      (value.trip?.id !== id ||
        !Array.isArray(value.catches) ||
        value.catches.some(
          (c) => !c.record?.id || c.record.tripId !== id || !!c.record.hasPhoto !== !!c.photo,
        ))
    )
      throw Error('Invalid trip');
    await db.restoreTrip(
      id,
      value && {
        trip: value.trip,
        catches: value.catches.map((c) => ({ record: c.record, photo: photoBlob(c.photo) })),
      },
    );
  } else if (key.startsWith('photo/')) await db.writeWaterPhoto(key.slice(6), photoBlob(value));
  else {
    const k = localKey(key.slice(5), subject);
    if (k && (value == null || typeof value === 'string')) {
      if (value == null) storage.removeItem(k);
      else storage.setItem(k, value);
    }
  }
}
