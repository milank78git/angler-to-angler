import { photoHash } from './journal-photos.js';

/** Keep each sync decision in the storage that holds the corresponding local document. */
export function journalHistory(db, storage, subject, epoch) {
  const prefix = 'journal.sync.v1.' + subject + '.';
  /** Locate the receipt for a portable preference in this account’s local storage. */
  const prefKey = (key) => prefix + 'state.' + key;
  /** Scope an IndexedDB receipt to its owner, cloud generation and document. */
  const id = (key) => [subject, epoch || '', key];
  /** Read the receipt from the same storage as its local document. */
  const get = async (key) =>
    key.startsWith('pref/') ? JSON.parse(storage.getItem(prefKey(key)) || 'null') : db.syncHistory(id(key));
  /** Persist the pending or acknowledged state before releasing the caller. */
  const put = async (key, state) => {
    if (key.startsWith('pref/')) storage.setItem(prefKey(key), JSON.stringify(state));
    else await db.writeSyncHistory(id(key), state);
  };

  /** Move legacy checkpoints and held decisions before deleting their old keys. */
  async function migrate() {
    const legacy = new Set();
    for (let index = 0; index < storage.length; index++) {
      const name = storage.key(index);
      for (const field of ['base.', 'deviceOnly.']) {
        if (name.startsWith(prefix + field)) legacy.add(name.slice(prefix.length + field.length));
      }
    }
    // Older releases recorded only an account-wide pruning floor. For surviving
    // records without a checkpoint we cannot reconstruct whether a save was attempted.
    const oldFloor = storage.getItem(prefix + 'deletionFloor');
    if (oldFloor !== null) {
      for (const key of await db.tripKeys()) legacy.add('trip/' + key);
      for (const [, key] of await db.waterPhotoKeys()) legacy.add('photo/' + key);
    }
    for (const key of legacy) {
      const checkpoint = prefix + 'base.' + key,
        held = prefix + 'deviceOnly.' + key;
      if (!(await get(key))) {
        await put(key, {
          base: JSON.parse(storage.getItem(checkpoint)),
          ...(oldFloor !== null && !key.startsWith('pref/') && storage.getItem(checkpoint) === null
            ? { legacyFloor: Number(oldFloor) }
            : {}),
          pending: [],
          held: !!storage.getItem(held),
        });
      }
      // A restart between commit and cleanup reuses the destination.
      storage.removeItem(checkpoint);
      storage.removeItem(held);
    }
    if (oldFloor !== null) storage.removeItem(prefix + 'deletionFloor');
  }

  /** Enumerate both journal and preference receipts for reconciliation. */
  async function keys() {
    const result = (await db.syncHistoryKeys(subject, epoch || '')).map((key) => key[2]);
    for (let index = 0; index < storage.length; index++) {
      const name = storage.key(index);
      if (name.startsWith(prefKey('pref/'))) result.push(name.slice(prefKey('').length));
    }
    return result;
  }
  return { get, put, migrate, keys, receipt: (key, state) => ({ id: id(key), state }) };
}

/** Compare ordered manifest parts, including their position and count. */
export const sameParts = (a, b) => a.length === b.length && a.every((part, i) => part === b[i]);

/** A listing can acknowledge any attempted version, including a manifest converted by maintenance. */
export async function observeRevision(state, row, floor) {
  /** Recognize the listed manifest or its pre-conversion photo digest. */
  const matches = async (parts) =>
    sameParts(parts, row.parts) ||
    (!!row.legacy && (await photoHash(new Blob([parts.join(',')]))) === row.legacy);
  // A timed-out save may still arrive after the listing if its CAS is still valid.
  const inFlight = state.pending.filter(
    (attempt) => attempt.revision === row.revision && (row.revision !== 0 || attempt.floor === floor),
  );
  for (const attempt of state.pending) {
    if (row.revision > attempt.revision && (await matches(attempt.parts))) {
      return { state: { base: row.parts, pending: inFlight, held: false }, inFlight };
    }
  }
  if (state.base && !sameParts(state.base, row.parts) && (await matches(state.base)))
    state = { ...state, base: row.parts };
  if (row.parts.length && state.held) state = { ...state, held: false };
  return { state, inFlight };
}

// These bridge responses reject the request or roll back the RPC. A timeout or client disconnect
// (including HTTP 408/499) does not establish the transaction outcome.
const rejectedSave = new Set([400, 401, 403, 404, 405, 409, 410, 413, 415, 422, 426, 429]);

/** Stage bytes freely. Only the final save can change the document on the server. */
export async function saveWithReceipt(call, args, state, persist) {
  const { parts, revision, floor } = args;
  const priorAttempt = state.pending.some(
    (attempt) => attempt.revision === revision && attempt.floor === floor && sameParts(attempt.parts, parts),
  );
  if (!priorAttempt) await persist({ ...state, pending: [...state.pending, { parts, revision, floor }] });
  try {
    return await call('save', args);
  } catch (error) {
    // Rejecting a retry says nothing about a previous request with the same contents.
    if (!priorAttempt && rejectedSave.has(error.status)) await persist(state);
    throw error;
  }
}
