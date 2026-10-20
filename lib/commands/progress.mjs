import fs from 'node:fs';
import { RilError, noProjectError } from '../errors.mjs';
import { statePath } from '../store.mjs';
import { appendOwned } from '../safe-fs.mjs';

export default {
  name: 'progress',
  summary: 'Add a line to the project progress log and show it.',
  usage: 'ril progress "<line>"',
  run(ctx, argv) {
    const line = argv.join(' ').replace(/\s*[\r\n]+\s*/g, ' ').trim();
    if (!line) throw new RilError('There is no progress line to record.', { next: 'run ril progress "what just happened"' });
    if (!fs.existsSync(statePath(ctx.dir))) throw noProjectError(ctx.dir);
    appendOwned(ctx.dir, 'log.md', `${ctx.now().toISOString()}\t${line}\n`);
    ctx.out(ctx.json ? JSON.stringify({ line }) : line);
  },
};
