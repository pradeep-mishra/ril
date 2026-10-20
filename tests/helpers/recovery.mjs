// Builders for broken situations, made by changing the state directly as a crash would leave it.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mutate, statePath } from '../../lib/store.mjs';

const child = path.join(path.dirname(fileURLToPath(import.meta.url)), 'store-child.mjs');

export const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();
export const read = (file) => fs.readFileSync(file, 'utf8');
export const stateFiles = (dir) => [statePath(dir), `${statePath(dir)}.bak`].map((f) => (fs.existsSync(f) ? read(f) : null));

export function addAgent(dir, id, { unit = 'U1', minutes = 1, state = 'running' } = {}) {
  const at = minutesAgo(minutes);
  mutate(dir, (s) => s.agents.push({ id, role: 'implementer', unit, task: 'build it', state, result: null, started: at, updated: at }));
}

export function addUnit(dir, id, state = 'doing') {
  mutate(dir, (s) => s.units.push({ id, kind: 'task', parent: null, title: `Task ${id}`, state, checkpoint: null, updated: minutesAgo(1) }));
}

export function writeReport(dir, id) {
  const file = path.join(dir, '.ril', 'agents', id, 'report.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'STATUS: done\n');
}

// The id of a process that has already exited.
export function deadPid() {
  return spawnSync(process.execPath, ['-e', '']).pid;
}

// Starts a real child that keeps changing the state, and kills it without warning after `ms`.
export function killMidWrite(dir, ms) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [child, dir, 'mutate', '1000000', 'kill'], { stdio: 'ignore' });
    p.on('error', reject);
    p.on('exit', () => resolve());
    setTimeout(() => p.kill('SIGKILL'), ms);
  });
}
