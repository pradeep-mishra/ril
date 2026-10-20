import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A fresh temp project folder with .ril/ created. Call cleanup() when done.
export function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ril-test-'));
  fs.mkdirSync(path.join(dir, '.ril'));
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  return { dir, cleanup };
}
