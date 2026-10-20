import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A fresh temp project folder with .ril/ created. Call cleanup() when done.
export function tmpProject({ bare = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ril-test-'));
  if (!bare) fs.mkdirSync(path.join(dir, '.ril'));
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  return { dir, cleanup };
}

// Runs fn(dir) in a fresh temp folder (with .ril/ unless bare) and removes the folder afterwards; fn may be async.
export function inTmp(fn, options) {
  const { dir, cleanup } = tmpProject(options);
  let result;
  try {
    result = fn(dir);
  } catch (err) {
    cleanup();
    throw err;
  }
  return result instanceof Promise ? result.finally(cleanup) : (cleanup(), result);
}
