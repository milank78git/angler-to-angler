/** Decode and re-encode into pixels only, dropping source EXIF and location metadata. */
export const pixelJpeg = (file, edge) => pixelCopy(file, edge, 'image/jpeg');

/** Decode and redraw the image at a bounded size before exporting pixels in the requested format. */
async function pixelCopy(file, maxEdge, type) {
  if (!file) return null;
  if (file.size > 30 * 1024 * 1024) throw Error('photo');
  const url = URL.createObjectURL(file),
    image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(Error('photo'));
      image.src = url;
    });
    const ratio = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b?.type === type ? resolve(b) : reject(Error('photo'))), type, 0.84),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Keep just the lossy frame from canvas encoders that also emit a color profile. */
export async function competitionPhoto(file, edge) {
  const webp = await pixelCopy(file, edge, 'image/webp');
  const buffer = await webp.arrayBuffer(),
    bytes = new Uint8Array(buffer),
    view = new DataView(buffer);
  /** Read a four-byte WebP chunk identifier at the supplied offset. */
  const type = (offset) => view.getUint32(offset);
  if (bytes.length < 20 || type(0) !== 0x52494646 || type(8) !== 0x57454250) throw Error('WebP');
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const length = view.getUint32(offset + 4, true),
      padded = length + (length % 2);
    if (offset + 8 + padded > bytes.length) throw Error('WebP chunk');
    if (type(offset) === 0x56503820) {
      const header = bytes.slice(0, 12);
      new DataView(header.buffer).setUint32(4, 12 + padded, true);
      return new Blob(
        [header, bytes.subarray(offset, offset + 8 + length), new Uint8Array(padded - length)],
        { type: 'image/webp' },
      );
    }
    offset += 8 + padded;
  }
  throw Error('WebP frame unavailable');
}
