import fs from 'node:fs';
import path from 'node:path';
import { RilError } from '../errors.mjs';
import { CAP_DEFAULT, CAP_MAX, CAP_MIN, MODES, emptyState } from '../schema.mjs';
import { createState, findProject, load, mutate, statePath } from '../store.mjs';
import { need, parseFlags } from '../records.mjs';
import { commitAll, ignoreLocal, isRepo } from '../git.mjs';
import { changedLine, declared, idsAt } from '../proof.mjs';
import { appendOwned, assertRilDir, resolveInProject, writeFileAtomic } from '../safe-fs.mjs';

// The routing block ril keeps in a project's CLAUDE.md and AGENTS.md.
// Files are handled as latin1 so every byte outside the block survives unchanged.

const START = '<!-- ril:managed:start -->';
const END = '<!-- ril:managed:end -->';
const LINE =
  'This project is managed by RIL. For any request about this project (continue, fix, change, status), start with the RIL front door (/ril); it re-reads .ril/ state.';

// Positions where `marker` is a whole line by itself.
function markerLines(text, marker) {
  const found = [];
  for (let at = text.indexOf(marker); at !== -1; at = text.indexOf(marker, at + 1)) {
    const after = text.slice(at + marker.length, at + marker.length + 2);
    if ((at === 0 || text[at - 1] === '\n') && (after === '' || after[0] === '\n' || after === '\r\n')) found.push(at);
  }
  return found;
}

// Returns `text` with the block added or refreshed, or null when the markers are damaged
// (anything other than no markers, or one start followed by one end).
function withBlock(text) {
  const starts = markerLines(text, START);
  const ends = markerLines(text, END);
  if (starts.length === 0 && ends.length === 0) {
    const nl = text.includes('\r\n') ? '\r\n' : '\n';
    let gap = '';
    if (text !== '') {
      const trailing = text.match(/(\r?\n)*$/)[0].split('\n').length - 1;
      gap = text.endsWith('\n') ? nl.repeat(Math.max(0, 2 - trailing)) : nl + nl;
    }
    return `${text}${gap}${START}${nl}${LINE}${nl}${END}${nl}`;
  }
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) return null;
  const nl = text.startsWith('\r\n', starts[0] + START.length) ? '\r\n' : '\n';
  return `${text.slice(0, starts[0])}${START}${nl}${LINE}${nl}${END}${text.slice(ends[0] + END.length)}`;
}

// Puts the block into the project's `name` file (created if absent).
// Returns { changed } or { skip: <reason> } when the file was left alone.
function writeBlock(dir, name) {
  const target = resolveInProject(dir, name);
  if (target.skip) return { skip: target.skip };
  const exists = fs.existsSync(target.file);
  const before = exists ? fs.readFileSync(target.file, 'latin1') : '';
  const after = withBlock(before);
  if (after === null) return { skip: 'its RIL block looks damaged' };
  if (after === before && exists) return { changed: false };
  writeFileAtomic(target.file, after, 'latin1');
  return { changed: true };
}

const FIX_BLOCK = ' Fix or remove the lines between the RIL markers, then run ril init again.';

// Makes sure the folders, the repository's local ignore entries, log and routing blocks are in place. Returns notes for the person.
function repair(dir) {
  const ril = path.join(dir, '.ril');
  for (const sub of ['docs', 'evidence', 'agents']) fs.mkdirSync(path.join(ril, sub), { recursive: true });
  appendOwned(dir, 'log.md', '');
  if (isRepo(dir)) ignoreLocal(dir);
  const notes = [];
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const { skip } = writeBlock(dir, name);
    if (skip) notes.push(`I left ${name} alone because ${skip}.${skip.includes('damaged') ? FIX_BLOCK : ''}`);
  }
  return notes;
}

const initCommand = {
  name: 'init',
  summary: 'Set up ril in this folder (safe to run again).',
  usage: 'ril init [--name <project>] [--mode autonomous|guided] [--cap 5..10]',
  run(ctx, argv) {
    const { flags } = parseFlags(argv, { values: ['name', 'mode', 'cap'] });
    const mode = flags.mode ?? 'autonomous';
    if (!MODES.includes(mode)) {
      throw new RilError(`The mode ${JSON.stringify(mode)} is not one ril knows.`, { next: `use --mode ${MODES.join(' or --mode ')}` });
    }
    const cap = flags.cap === undefined ? CAP_DEFAULT : Number(flags.cap);
    if (!/^\d+$/.test(flags.cap ?? '0') || cap < CAP_MIN || cap > CAP_MAX) {
      throw new RilError(`The fix-round limit ${JSON.stringify(flags.cap)} is not allowed.`, { next: `use --cap with a whole number from ${CAP_MIN} to ${CAP_MAX}` });
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
        state = createState(dir, { ...emptyState({ project: flags.name || path.basename(dir), mode }), cap, pluginRoot: ctx.pluginRoot });
      } catch (err) {
        if (!fs.existsSync(statePath(dir))) throw err;
        existing = true; // another init got there first: carry on as a repeat run
      }
    }
    if (existing) {
      state = load(dir);
      if (flags.cap !== undefined && cap !== state.cap) notes.push(`The fix-round limit was kept at ${state.cap}; it is set once, when the project is created.`);
      if (state.pluginRoot !== ctx.pluginRoot) state = mutate(dir, (s) => { s.pluginRoot = ctx.pluginRoot; });
    }
    notes.push(...repair(dir));
    if (ctx.json) return ctx.out(JSON.stringify({ created: !existing, dir, project: state.project, mode: state.mode, notes }));
    for (const note of notes) ctx.out(note);
    ctx.out(existing ? `ril was already set up here for ${state.project}; nothing was changed except repairs.` : `ril is set up for ${state.project} in ${dir}.`);
  },
};

const USAGE = 'ril checkpoint [--message <text>] [--seal]';

const checkpointCommand = {
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

const rootCommand = {
  name: 'root',
  summary: 'Print the folder where this plugin is installed.',
  usage: 'ril root',
  run(ctx) {
    ctx.out(ctx.json ? JSON.stringify({ root: ctx.pluginRoot }) : ctx.pluginRoot);
  },
};

export default [initCommand, checkpointCommand, rootCommand];
