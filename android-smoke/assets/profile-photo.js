// Select a synthetic PNG through the same file-input change event as Android's picker.
(() => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  canvas.toBlob((blob) => {
    const files = new DataTransfer();
    files.items.add(new File([blob], 'profile.png', { type: 'image/png' }));
    const input = document.querySelector('#profile-photo');
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
})();
