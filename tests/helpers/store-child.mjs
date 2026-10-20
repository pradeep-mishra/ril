// Run by tests as a real child process.
//   node store-child.mjs <dir> mutate <count> <tag> [marker]  pushes <count> decisions; writes the
//                                                     marker file once the first one is saved
//   node store-child.mjs <dir> hold                   takes the lock, prints "locked", waits to be killed
import fs from 'node:fs';
import { mutate, withLock } from '../../lib/store.mjs';

const [dir, mode, count, tag, marker] = process.argv.slice(2);

if (mode === 'mutate') {
  for (let i = 0; i < Number(count); i++) {
    mutate(dir, (s) => {
      s.decisions.push({ ts: new Date().toISOString(), stage: s.stage, decision: `${tag}-${i}`, why: 'test' });
    });
    if (i === 0 && marker) fs.writeFileSync(marker, 'saved\n');
  }
} else if (mode === 'hold') {
  withLock(dir, () => {
    fs.writeSync(1, 'locked\n');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
  });
}
