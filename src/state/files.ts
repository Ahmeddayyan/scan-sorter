/** Accepting / rejecting dropped files. Pure, so it can be tested in Node. */

export interface FileLike {
  name: string;
  type: string;
}

export type FileClass = 'pdf' | 'image' | 'heic' | 'unsupported';

export const ACCEPT_ATTR = 'application/pdf,.pdf,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

function extensionOf(name: string): string {
  const m = /\.([^./\\]+)$/.exec(name);
  return m ? m[1]!.toLowerCase() : '';
}

export function classifyFile(file: FileLike): FileClass {
  const type = file.type.toLowerCase();
  const ext = extensionOf(file.name);
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (type === 'image/heic' || type === 'image/heif' || ext === 'heic' || ext === 'heif') return 'heic';
  if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp') return 'image';
  if (IMAGE_EXTENSIONS.includes(ext) && (type === '' || !type.startsWith('image/'))) return 'image';
  return 'unsupported';
}

export interface RejectedFile {
  name: string;
  reason: string;
}

export function classifyFiles<T extends FileLike>(files: readonly T[]): { accepted: T[]; rejected: RejectedFile[] } {
  const accepted: T[] = [];
  const rejected: RejectedFile[] = [];
  for (const file of files) {
    const kind = classifyFile(file);
    if (kind === 'pdf' || kind === 'image') accepted.push(file);
    else if (kind === 'heic') {
      rejected.push({ name: file.name, reason: 'HEIC photos are not supported yet. Save or export them as JPG first.' });
    } else {
      rejected.push({ name: file.name, reason: 'Only PDF, JPG, PNG and WebP files can be used.' });
    }
  }
  return { accepted, rejected };
}

export function rejectionMessage(rejected: readonly RejectedFile[]): string {
  if (rejected.length === 0) return '';
  const first = rejected[0]!;
  if (rejected.length === 1) return `${first.name}: ${first.reason}`;
  return `${rejected.length} files were skipped (${first.name} and others). Only PDF, JPG, PNG and WebP files can be used.`;
}
