/* Shared dashboard image upload: file → base64 data URL → POST /api/upload
   (the same CDN path the storefront studio uses) → the public URL. */

export async function uploadImage(
  file: File,
  opts: { types?: RegExp; typesLabel?: string; maxBytes?: number; label?: string } = {},
): Promise<string> {
  const types = opts.types ?? /^image\/(png|jpe?g|webp)$/;
  const typesLabel = opts.typesLabel ?? 'PNG, JPEG, or WebP';
  const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024;
  const label = opts.label ?? 'Image';
  if (!types.test(file.type)) throw new Error(`${label} must be a ${typesLabel} image.`);
  if (file.size > maxBytes) throw new Error(`${label} must be under ${Math.round(maxBytes / 1024 / 1024)}MB.`);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const resp = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, dataUrl }),
  });
  const d = await resp.json().catch(() => ({}));
  if (!resp.ok || !d.url) throw new Error(d.error || 'Upload failed');
  return String(d.url);
}
