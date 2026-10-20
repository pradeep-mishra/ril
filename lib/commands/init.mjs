import fs from 'node:fs';
import path from 'node:path';
import { RilError } from '../errors.mjs';
import { MODES, emptyState } from '../schema.mjs';
import { createState, load, mutate, statePath } from '../store.mjs';
import { parseFlags } from '../args.mjs';
import { pluginRoot } from '../plugin-root.mjs';
import { writeBlock } from '../routing.mjs';

const IGNORE = '*\n!docs/\n!docs/**\n!.gitignore\n';

// Makes sure the folders, ignore file, log and routing blocks are in place.
function repair(dir) {
  const ril = path.join(dir, '.ril');
  for (const sub of ['docs', 'evidence', 'agents']) fs.mkdirSync(path.join(ril, sub), { recursive: true });
  const ignore = path.join(ril, '.gitignore');
  if (!fs.existsSync(ignore) || fs.readFileSync(ignore, 'utf8') !== IGNORE) fs.writeFileSync(ignore, IGNORE);
  const log = path.join(ril, 'log.md');
  if (!fs.existsSync(log)) fs.writeFileSync(log, '');
  for (const name of ['CLAUDE.md', 'AGENTS.md']) writeBlock(path.join(dir, name));
}

export default {
  name: 'init',
  summary: 'Set up ril in this folder (safe to run again).',
  usage: 'ril init [--name <project>] [--mode autonomous|guided]',
  run(ctx, argv) {
    const { flags } = parseFlags(argv, { values: ['name', 'mode'] });
    const mode = flags.mode ?? 'autonomous';
    if (!MODES.includes(mode)) {
      throw new RilError(`The mode ${JSON.stringify(mode)} is not one ril knows.`, { next: `use --mode ${MODES.join(' or --mode ')}` });
    }
    const dir = ctx.dir;
    const existing = fs.existsSync(statePath(dir));
    let state;
    if (existing) {
      state = load(dir);
      if (state.pluginRoot !== pluginRoot) state = mutate(dir, (s) => { s.pluginRoot = pluginRoot; });
    } else {
      state = createState(dir, { ...emptyState({ project: flags.name || path.basename(dir), mode }), pluginRoot });
    }
    repair(dir);
    if (ctx.json) return ctx.out(JSON.stringify({ created: !existing, dir, project: state.project, mode: state.mode }));
    ctx.out(existing ? `ril was already set up here for ${state.project}; nothing was changed except repairs.` : `ril is set up for ${state.project} in ${dir}.`);
  },
};
