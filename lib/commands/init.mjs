import fs from 'node:fs';
import path from 'node:path';
import { RilError } from '../errors.mjs';
import { MODES, emptyState } from '../schema.mjs';
import { createState, load, mutate, statePath } from '../store.mjs';
import { parseFlags } from '../args.mjs';
import { pluginRoot } from '../plugin-root.mjs';
import { writeBlock } from '../routing.mjs';
import { findProject } from '../find-project.mjs';
import { appendOwned, assertRilDir, ownedFile, writeFileAtomic } from '../safe-fs.mjs';

const IGNORE = '*\n!docs/\n!docs/**\n!.gitignore\n';
const FIX_BLOCK = ' Fix or remove the lines between the RIL markers, then run ril init again.';

// Makes sure the folders, ignore file, log and routing blocks are in place. Returns notes for the person.
function repair(dir) {
  const ril = path.join(dir, '.ril');
  for (const sub of ['docs', 'evidence', 'agents']) fs.mkdirSync(path.join(ril, sub), { recursive: true });
  const ignore = ownedFile(dir, '.gitignore');
  if (!fs.existsSync(ignore) || fs.readFileSync(ignore, 'utf8') !== IGNORE) writeFileAtomic(ignore, IGNORE);
  appendOwned(dir, 'log.md', '');
  const notes = [];
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const { skip } = writeBlock(dir, name);
    if (skip) notes.push(`I left ${name} alone because ${skip}.${skip.includes('damaged') ? FIX_BLOCK : ''}`);
  }
  return notes;
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
    assertRilDir(dir);
    const notes = [];
    let existing = fs.existsSync(statePath(dir));
    if (!existing) {
      const parent = findProject(path.dirname(dir));
      if (parent) notes.push(`A ril project already exists in ${parent}; this creates a separate one in ${dir}.`);
    }
    let state;
    if (!existing) {
      try {
        state = createState(dir, { ...emptyState({ project: flags.name || path.basename(dir), mode }), pluginRoot });
      } catch (err) {
        if (!fs.existsSync(statePath(dir))) throw err;
        existing = true; // another init got there first: carry on as a repeat run
      }
    }
    if (existing) {
      state = load(dir);
      if (state.pluginRoot !== pluginRoot) state = mutate(dir, (s) => { s.pluginRoot = pluginRoot; });
    }
    notes.push(...repair(dir));
    if (ctx.json) return ctx.out(JSON.stringify({ created: !existing, dir, project: state.project, mode: state.mode, notes }));
    for (const note of notes) ctx.out(note);
    ctx.out(existing ? `ril was already set up here for ${state.project}; nothing was changed except repairs.` : `ril is set up for ${state.project} in ${dir}.`);
  },
};
