import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'ril');

// Runs the real entry (`node bin/ril`) with `dir` as the working folder; no shell involved.
export function ril(dir, ...args) {
  const r = spawnSync(process.execPath, [entry, ...args], { cwd: dir, encoding: 'utf8' });
  if (r.error) throw r.error;
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
