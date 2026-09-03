import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function writeTextAtomic(file, content, options = {}) {
  const target = path.resolve(file);
  const directory = path.dirname(target);
  await fs.mkdir(directory, { recursive: true, ...(options.dirMode ? { mode: options.dirMode } : {}) });

  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, String(content), options.mode ? { mode: options.mode } : undefined);
    if (options.mode) await fs.chmod(temporary, options.mode).catch(() => {});
    await replaceFile(temporary, target);
    if (options.mode) await fs.chmod(target, options.mode).catch(() => {});
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export function writeJsonAtomic(file, value, options = {}) {
  return writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`, options);
}

async function replaceFile(temporary, target) {
  const deadline = Date.now() + 1000;
  while (true) {
    try {
      await fs.rename(temporary, target);
      return;
    } catch (error) {
      const retryable = process.platform === 'win32' && ['EACCES', 'EBUSY', 'EPERM'].includes(error?.code);
      if (!retryable || Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}
