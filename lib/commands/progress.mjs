import fs from 'node:fs';
import path from 'node:path';
import { RilError, noProjectError } from '../errors.mjs';
import { statePath } from '../store.mjs';

export default {
  name: 'progress',
  summary: 'Add a line to the project progress log and show it.',
  usage: 'ril progress "<line>"',
  run(ctx, argv) {
    const line = argv.join(' ').replace(/\s*[\r\n]+\s*/g, ' ').trim();
    if (!line) throw new RilError('There is no progress line to record.', { next: 'run ril progress "what just happened"' });
    if (!fs.existsSync(statePath(ctx.dir))) throw noProjectError(ctx.dir);
    fs.appendFileSync(path.join(ctx.dir, '.ril', 'log.md'), `${ctx.now().toISOString()}\t${line}\n`);
    ctx.out(ctx.json ? JSON.stringify({ line }) : line);
  },
};
