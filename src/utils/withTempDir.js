import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Menjalankan task dengan direktori sementara yang pasti dibersihkan. */
export async function withTempDir(task) {
  const dir = await mkdtemp(path.join(tmpdir(), 'twebot-lite-'));
  try {
    return await task(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
