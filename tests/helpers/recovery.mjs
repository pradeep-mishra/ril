// Builders for broken situations, made by changing the state directly as a crash would leave it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { load, mutate, statePath } from '../../lib/store.mjs';
import { addScenario, head, record, register, trustKit } from './repo.mjs';

const child = path.join(path.dirname(fileURLToPath(import.meta.url)), 'store-child.mjs');

export const JARGON = /\b(SHA|HEAD|stale|undefined|null|JSON\.parse|ENOENT)\b|\n\s+at /;
export const agent = (dir, id) => load(dir).agents.find((a) => a.id === id);
export const unit = (dir, id) => load(dir).units.find((u) => u.id === id);
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

export function writeReport(dir, id, text = '# Report\nSTATUS: done\n') {
  const file = path.join(dir, '.ril', 'agents', id, 'report.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// The id of a process that has already exited.
export function deadPid() {
  return spawnSync(process.execPath, ['-e', '']).pid;
}

// Starts a real child that keeps changing the state. Once it has saved one change (it writes `marker`),
// waits a random 0 to 300 ms and kills it without warning. Resolves when the child is gone.
export function killMidWrite(dir, marker, { startMs = 30_000 } = {}) {
  fs.rmSync(marker, { force: true });
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [child, dir, 'mutate', '1000000', 'kill', marker], { stdio: 'ignore' });
    let timer;
    const deadline = Date.now() + startMs;
    const watch = setInterval(() => {
      if (fs.existsSync(marker)) {
        clearInterval(watch);
        timer = setTimeout(() => p.kill('SIGKILL'), Math.floor(Math.random() * 301));
      } else if (Date.now() > deadline) {
        clearInterval(watch);
        p.kill('SIGKILL');
        reject(new Error('the child never saved a change'));
      }
    }, 5);
    p.on('error', (err) => {
      clearInterval(watch);
      reject(err);
    });
    p.on('exit', () => {
      clearInterval(watch);
      clearTimeout(timer);
      if (fs.existsSync(marker)) resolve();
      else reject(new Error('the child stopped before it saved a change'));
    });
  });
}

// A project where scenario S1 is proven by verifier V1 at the current saved version.
export function proveS1(dir) {
  addScenario(dir, 'S1');
  register(dir, 'V1', 'verifier');
  trustKit(dir);
  assert.equal(record(dir, 'S1', head(dir), 'proven-cli').code, 0);
}
