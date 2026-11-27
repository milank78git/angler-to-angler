/** Keep binary originals independent of revisions to the trip that describes them. */
const partSize = 65536;
export const photoHash = async (blob) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

export async function stagePhoto(call, ref, file, operation = 'photo_prepare') {
  if (!file || file.size > 16777216)
    throw Object.assign(Error('Photo unavailable or too large'), { status: 413 });
  for (let offset = 0; offset < file.size; offset += partSize) {
    const bytes = new Uint8Array(await file.slice(offset, offset + partSize).arrayBuffer());
    let text = '';
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    await call('photo_part', { ...ref, part: offset / partSize, data: btoa(text) });
  }
  return call(operation, ref);
}

export async function restorePhoto(call, ref, existing) {
  if (existing && (await photoHash(existing)) === ref.hash) return existing;
  const parts = [];
  for (let offset = 0; ; offset += partSize) {
    const result = await call('photo_get', { ...ref, offset });
    if (result.expired) return null;
    const bytes = Uint8Array.from(atob(result.data), (ch) => ch.charCodeAt(0));
    if (
      !Number.isInteger(result.size) ||
      result.size > 16777216 ||
      bytes.length === 0 ||
      bytes.length !== Math.min(partSize, result.size - offset)
    )
      throw Error('Invalid photo part');
    parts.push(bytes);
    if (offset + bytes.length === result.size) break;
  }
  const blob = new Blob(parts, { type: 'image/jpeg' });
  if ((await photoHash(blob)) !== ref.hash) throw Error('Invalid photo digest');
  return blob;
}
