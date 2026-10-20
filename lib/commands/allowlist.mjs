import fs from 'node:fs';
import { RilError } from '../errors.mjs';
import { loadRecipe } from '../recipe.mjs';
import { parseFlags } from '../args.mjs';
import { dispatch, need, say } from '../records.mjs';
import { projectFile, writeFileAtomic } from '../safe-fs.mjs';

const WRITE = 'ril allowlist write (--recipe <recipe-folder> | --base) --tool claude';
const SETTINGS = '.claude/settings.json';
// What every stage needs before a recipe is chosen (forms measured in the spikes notes).
export const BASE_ENTRIES = ['Bash(ril *)', 'Bash(git *)', 'Edit(.ril/**)', 'Read(.ril/**)'];

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

// Settings files sometimes carry comments, which plain JSON does not allow. Returns the parsed text once comments are
// taken out, or null when removing them does not make it valid (so the message only blames comments when they are the cause).
function withoutComments(text) {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s,{[])\/\/.*$/gm, '$1'));
  } catch {
    return null;
  }
}

// The settings already on disk as an object, or {} when there is no file. Anything unreadable is refused, never replaced.
function readSettings(file) {
  const refuse = (why) => new RilError(`${file} ${why}, so ril will not change it.`, { next: 'fix the file or move it out of the way, then run this again' });
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new RilError(`Could not read ${file}.`, { next: 'check the file can be read, then try again', detail: err.message });
  }
  let settings;
  try {
    settings = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw refuse(withoutComments(text) === null ? 'is not valid JSON' : 'is not valid JSON (comments are not allowed in this file)');
  }
  if (!isObject(settings)) throw refuse('does not hold a JSON object');
  if (settings.permissions !== undefined && !isObject(settings.permissions)) throw refuse('has a "permissions" that is not an object');
  if (settings.permissions?.allow !== undefined && !Array.isArray(settings.permissions.allow)) throw refuse('has a "permissions.allow" that is not a list');
  return settings;
}

function write(ctx, argv) {
  const { flags, rest } = parseFlags(argv, { values: ['recipe', 'tool'], bools: ['base'] });
  const tool = need(flags, 'tool', WRITE);
  if (tool === 'codex') throw new RilError('Codex support comes later, so ril cannot write its permissions yet.', { next: 'use --tool claude for now' });
  if (tool !== 'claude') throw new RilError(`ril does not know the tool ${JSON.stringify(tool)}.`, { next: 'use --tool claude' });
  if (rest.length) throw new RilError(`ril allowlist write does not know ${rest[0]}.`, { next: `run: ${WRITE}` });
  if (Boolean(flags.base) === (flags.recipe !== undefined)) {
    throw new RilError('Say which entries to write: either --recipe <folder> or --base, not both and not neither.', { next: `run: ${WRITE}` });
  }
  const wanted = [...BASE_ENTRIES];
  if (flags.recipe !== undefined) wanted.push(...(loadRecipe(need(flags, 'recipe', WRITE), ctx.cwd, ctx.recipeRoot).recipe.allowlist?.claude ?? []));

  const file = projectFile(ctx.dir, '.claude', 'settings.json');
  const settings = readSettings(file);
  const allow = settings.permissions?.allow ?? [];
  const added = [];
  // A duplicate is an identical string only; a near match (other spacing or case) is a different rule and is kept alongside.
  for (const entry of wanted) {
    if (!allow.includes(entry) && !added.includes(entry)) added.push(entry);
  }
  if (added.length) {
    settings.permissions = { ...settings.permissions, allow: [...allow, ...added] };
    writeFileAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);
  }
  const trust = 'Claude Code will ask you once to trust this project folder; say yes, or these permissions do not take effect.';
  say(ctx, added.length ? `Added ${added.length} permission${added.length === 1 ? '' : 's'} to ${SETTINGS} so work can go on without constant questions. ${trust}` : `${SETTINGS} already allows everything this needs; nothing changed. ${trust}`, { file, added });
}

export default {
  name: 'allowlist',
  summary: 'Write the permissions this project needs into Claude Code settings.',
  usage: WRITE,
  run: (ctx, argv) => dispatch(ctx, argv, 'allowlist', { write }),
};
