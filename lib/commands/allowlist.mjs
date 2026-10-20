import fs from 'node:fs';
import { RilError } from '../errors.mjs';
import { approvedHash, checkAllow, loadTools } from '../tools.mjs';
import { load } from '../store.mjs';
import { parseFlags } from '../args.mjs';
import { dispatch, need, say } from '../records.mjs';
import { projectFile, writeFileAtomic } from '../safe-fs.mjs';
import { pluginRoot } from '../plugin-root.mjs';

const WRITE = 'ril allowlist write (--base | --approved) --tool claude | ril allowlist hash';
const SETTINGS = '.claude/settings.json';
// What every stage needs before the tool list is approved: product files and the plugin folder (templates, rules;
// run log 2026-10-20, C2). The host writes an absolute path with a second leading slash and a drive as /c/.
const hostPath = pluginRoot.replace(/\\/g, '/').replace(/^(\w):/, (_, d) => `/${d.toLowerCase()}`);
export const BASE_ENTRIES = ['Bash(ril *)', 'Bash(git *)', 'Edit(./**)', 'Read(./**)', `Read(/${hostPath}/**)`];
// No worker may write ril's state, the permission settings or the git folder (its hooks) with the Edit or Write tool;
// ril writes its state and .claude/settings.json through node, and git writes .git itself. Deny rules apply at once, even before the folder is trusted,
// and beat any allow rule.
const PROTECTED = ['.ril/state.json', '.ril/state.json.bak', '.ril/state.json.damaged-*', '.ril/.lock', '.ril/.lock.break', '.claude/**', '.git/**'];
export const DENY_ENTRIES = ['Edit', 'Write'].flatMap((tool) => PROTECTED.map((file) => `${tool}(${file})`));

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

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
    throw refuse('is not valid JSON');
  }
  if (!isObject(settings)) throw refuse('does not hold a JSON object');
  if (settings.permissions !== undefined && !isObject(settings.permissions)) throw refuse('has a "permissions" that is not an object');
  for (const key of ['allow', 'deny']) {
    if (settings.permissions?.[key] !== undefined && !Array.isArray(settings.permissions[key])) throw refuse(`has a "permissions.${key}" that is not a list`);
  }
  return settings;
}

// The entries of `wanted` that `list` does not hold yet, each once, in order. A duplicate is an identical
// string only; a near match (other spacing or case) is a different rule and is kept alongside.
function missing(list = [], wanted) {
  const out = [];
  for (const entry of wanted) {
    if (!list.includes(entry) && !out.includes(entry)) out.push(entry);
  }
  return out;
}

// The permissions of the project's tool list, only when ril accepts every one of them and the person approved
// this exact list (the hash in the last "Approved tools" decision). --force does not apply here.
function approvedAllow(dir) {
  const state = load(dir);
  const { tools, hash } = loadTools(dir);
  const allow = tools.allow ?? [];
  const bad = checkAllow(allow);
  if (bad.length) throw new RilError(`ril will not grant the permissions this tool list asks for:\n${bad.join('\n')}`, { next: 'take them out of .ril/tools.json, show the person the new list and ask again' });
  if (approvedHash(state) !== hash) {
    throw new RilError('The person has not approved this tool list as it is now, so ril will not grant its permissions.', { next: `show the person the list from ril preflight, and once they agree run: ril decision log --stage design --decision "Approved tools ${hash}" --why "<what the person said>"` });
  }
  return allow;
}

function write(ctx, argv) {
  const { flags, rest } = parseFlags(argv, { values: ['tool'], bools: ['base', 'approved'] });
  const tool = need(flags, 'tool', WRITE);
  if (tool !== 'claude') throw new RilError(`ril does not know the tool ${JSON.stringify(tool)}.`, { next: 'use --tool claude' });
  if (rest.length) throw new RilError(`ril allowlist write does not know ${rest[0]}.`, { next: `run: ${WRITE}` });
  if (Boolean(flags.base) === Boolean(flags.approved)) {
    throw new RilError('Say which entries to write: either --base or --approved, not both and not neither.', { next: `run: ${WRITE}` });
  }
  const wanted = [...BASE_ENTRIES, ...(flags.approved ? approvedAllow(ctx.dir) : [])];

  const file = projectFile(ctx.dir, '.claude', 'settings.json');
  const settings = readSettings(file);
  const added = missing(settings.permissions?.allow, wanted);
  const denied = missing(settings.permissions?.deny, DENY_ENTRIES);
  if (added.length || denied.length) {
    settings.permissions = { ...settings.permissions };
    if (added.length) settings.permissions.allow = [...(settings.permissions.allow ?? []), ...added];
    if (denied.length) settings.permissions.deny = [...(settings.permissions.deny ?? []), ...denied];
    writeFileAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);
  }
  const trust = 'Claude Code will ask you once to trust this project folder; say yes, or these permissions do not take effect.';
  const count = added.length + denied.length;
  const text = count
    ? `Added ${count} permission rule${count === 1 ? '' : 's'} to ${SETTINGS} so work can go on without constant questions and no agent can edit ril's own records directly. ${trust}`
    : `${SETTINGS} already has everything this needs; nothing changed. ${trust}`;
  say(ctx, text, { file, added, denied });
}

function hash(ctx) {
  const { hash } = loadTools(ctx.dir);
  say(ctx, hash, { hash });
}

export default {
  name: 'allowlist',
  summary: 'Write the permissions this project needs into Claude Code settings.',
  usage: WRITE,
  run: (ctx, argv) => dispatch(ctx, argv, 'allowlist', { write, hash }),
};
