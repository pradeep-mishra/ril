import { load } from '../store.mjs';
import { need } from '../records.mjs';
import { parseFlags } from '../args.mjs';
import { commitAll } from '../git.mjs';

const USAGE = 'ril checkpoint [--message <text>]';

export default {
  name: 'checkpoint',
  summary: 'Save the current version of the project and print its id.',
  usage: USAGE,
  run(ctx, argv) {
    const { flags } = parseFlags(argv, { values: ['message'] });
    const state = load(ctx.dir); // only a ril project is saved
    const message = flags.message === undefined ? `ril checkpoint (${state.stage} stage)` : need(flags, 'message', USAGE);
    const id = commitAll(ctx.dir, message);
    ctx.out(ctx.json ? JSON.stringify({ checkpoint: id }) : id);
  },
};
