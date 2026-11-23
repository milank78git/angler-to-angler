/** Decode and re-encode into pixels only, dropping source EXIF and location metadata. */
export async function pixelJpeg(file, maxEdge) {
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
      canvas.toBlob((b) => (b ? resolve(b) : reject(Error('photo'))), 'image/jpeg', 0.84),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
