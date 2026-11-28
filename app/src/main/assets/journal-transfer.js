import { photoHash, stagePhoto, restorePhoto } from './journal-photos.js';
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
function stableFields(_key, value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, value[key]]),
      )
    : value;
}
export async function encodeDocument(db, storage, subject, key, detached = false) {
  const photos = [];
  let value;
  if (key.startsWith('trip/')) {
    const id = key.slice(5),
      trip = await db.trip(id);
    if (trip) {
      const catches = [];
      for (const entry of await db.catches(id)) {
        const { cloudPhotoHash, ...record } = entry;
        const file = await db.photo(record.id);
        if (detached) {
          const digest = file ? await photoHash(file) : cloudPhotoHash;
          if (digest) photos.push({ id: record.id, hash: digest, file });
          catches.push({ record: { ...record, hasPhoto: !!digest }, photoHash: digest || null });
        } else catches.push({ record, photo: await photoData(file) });
      }
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
    const bytes = encoder.encode(
      JSON.stringify({ version: detached ? 2 : 1, value }, detached ? stableFields : undefined),
    );
    if (bytes.length > 1024 * 65536) throw Object.assign(Error('Document too large'), { status: 413 });
    for (let i = 0; i < bytes.length; i += 65536) {
      const part = bytes.subarray(i, i + 65536),
        digest = await hash(part);
      hashes.push(digest);
      blocks.set(digest, part);
    }
  }
  return { hashes, blocks, ...(detached ? { photos } : {}) };
}
/** Read a committed digest for comparisons. Materialize bytes only for dirty documents or an upload. */
export async function localDocument(db, storage, subject, key, needBlocks = false, detached = false) {
  if (key.startsWith('pref/')) return encodeDocument(db, storage, subject, key);
  const cached = await db.fingerprint(key);
  if (cached?.hashes && !!cached.detached === detached && !needBlocks)
    return { hashes: cached.hashes, version: cached.version };
  const local = await encodeDocument(db, storage, subject, key, detached);
  if (!(await db.cacheHashes(key, cached?.version, local.hashes, detached)))
    throw Object.assign(Error('Journal changed during encoding'), { status: 409 });
  return { ...local, version: cached?.version };
}

export async function uploadDocument(
  call,
  key,
  local,
  revision,
  floor = 0,
  save = (args) => call('save', args),
) {
  // Positions refer to the ordered photo references in this exact manifest.
  const unavailable = {};
  for (const [index, { id, hash, file }] of (local.photos || []).entries()) {
    const ref = { trip: key, id, hash };
    if (!(await call('photo_need', ref)).needed) continue;
    if (file) await stagePhoto(call, ref, file);
    else unavailable[index] = true;
  }
  if (local.hashes.length) {
    const { hashes } = await call('missing', { hashes: [...local.blocks.keys()] });
    for (const h of hashes) await call('put', { hash: h, data: toBase64(local.blocks.get(h)) });
  }
  return (
    await save({
      key,
      revision,
      floor,
      parts: local.hashes,
      ...(Object.keys(unavailable).length ? { unavailable } : {}),
      ...(local.photos ? { format: 2 } : {}),
    })
  ).revision;
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
  if (value.version === 2 && Array.isArray(value.value?.catches)) return { ...value.value, detached: true };
  if (value.version !== 1) throw Error('Unsupported journal version');
  return value.value;
}
/** Prepare and verify remote bytes without occupying the journal writer queue. */
export async function prepareRestore(db, storage, subject, key, value, call = undefined) {
  if (key.startsWith('trip/')) {
    const id = key.slice(5);
    if (
      value &&
      (value.trip?.id !== id ||
        !Array.isArray(value.catches) ||
        new Set(value.catches.map((c) => c?.record?.id)).size !== value.catches.length ||
        value.catches.some(
          (c) =>
            !c?.record?.id ||
            c.record.tripId !== id ||
            !!c.record.hasPhoto !== !!(value.detached ? c.photoHash : c.photo) ||
            (value.detached && c.photoHash && !/^[a-f0-9]{64}$/.test(c.photoHash)),
        ))
    )
      throw Error('Invalid trip');
    if (!value)
      return (expected = undefined, receipt = undefined) => db.restoreTrip(id, null, expected, receipt);
    const catches = [];
    for (const c of value.catches) {
      const photo =
        value.detached && c.photoHash
          ? await restorePhoto(
              call,
              { trip: key, id: c.record.id, hash: c.photoHash },
              await db.photo(c.record.id),
            )
          : photoBlob(c.photo);
      catches.push({
        record: value.detached ? { ...c.record, hasPhoto: !!photo, cloudPhotoHash: c.photoHash } : c.record,
        photo,
      });
    }
    return (expected = undefined, receipt = undefined) =>
      db.restoreTrip(id, { trip: value.trip, catches }, expected, receipt);
  }
  if (key.startsWith('photo/'))
    return (expected = undefined, receipt = undefined) =>
      db.writeWaterPhoto(key.slice(6), photoBlob(value), expected, receipt);
  return async () => {
    const k = localKey(key.slice(5), subject);
    if (k && (value == null || typeof value === 'string')) {
      if (value == null) storage.removeItem(k);
      else storage.setItem(k, value);
    }
  };
}

export async function restoreDocument(db, storage, subject, key, value, call = undefined) {
  const apply = await prepareRestore(db, storage, subject, key, value, call);
  await apply();
}
