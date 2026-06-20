import { put, del } from '@vercel/blob';

export type UploadedBlob = { url: string; pathname: string };

/** Upload an image to Vercel Blob under a per-group prefix. The token is read
 *  from BLOB_READ_WRITE_TOKEN. Dimensions are measured client-side and stored
 *  separately. */
export async function uploadImage(
  file: File,
  groupId: number
): Promise<UploadedBlob> {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const rand = Math.random().toString(36).slice(2, 8);
  const key = `bakery/${groupId}/${Date.now()}-${rand}.${ext || 'jpg'}`;
  const blob = await put(key, file, { access: 'public', addRandomSuffix: false });
  return { url: blob.url, pathname: blob.pathname };
}

/** Remove a blob by its pathname (or URL). Best-effort — never throws. */
export async function deleteImage(pathname: string): Promise<void> {
  try {
    await del(pathname);
  } catch (err) {
    console.error('[media] delete failed:', err);
  }
}
