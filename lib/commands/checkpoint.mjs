import { load, mutate } from '../store.mjs';
import { need } from '../records.mjs';
import { parseFlags } from '../args.mjs';
import { commitAll } from '../git.mjs';
import { changedLine, declared, idsAt } from '../seal.mjs';

const USAGE = 'ril checkpoint [--message <text>] [--seal]';

export default {
  name: 'checkpoint',
  summary: 'Save the current version of the project and print its id (--seal also seals the protected files).',
  usage: USAGE,
  run(ctx, argv) {
    const { flags } = parseFlags(argv, { values: ['message'], bools: ['seal'] });
    const state = load(ctx.dir); // only a ril project is saved
    const message = flags.message === undefined ? `ril checkpoint (${state.stage} stage)` : need(flags, 'message', USAGE);
    const id = commitAll(ctx.dir, message);
    ctx.out(ctx.json ? JSON.stringify({ checkpoint: id }) : id);
    if (flags.seal) {
      mutate(ctx.dir, (s) => (s.seals ??= []).push({ version: id, paths: idsAt(ctx.dir, id, declared(ctx.dir).inside), ts: ctx.now().toISOString() }));
    } else {
      const line = changedLine(ctx.dir, state.seals);
      if (line) ctx.err(line);
    }
  },
};
