// The project's tool list (.ril/tools.json) and its three users: ril preflight checks the tools are installed,
// ril allowlist write grants the permissions the person approved.
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { RilError } from '../errors.mjs';
import { load } from '../store.mjs';
import { dispatch, need, parseFlags, say } from '../records.mjs';
import { ownedFile, projectFile, readText, writeFileAtomic } from '../safe-fs.mjs';

const FIX = 'fix .ril/tools.json (the design stage writes it), then try again';
// A detect command is run before the person approves anything, so it is only ever a program name (no path)
// with one version-style argument, started without a shell.
const VERSION_ARGS = ['--version', '-v', '-V', 'version', '--help'];
const DETECT = new RegExp(`^[A-Za-z0-9][A-Za-z0-9._+-]* (${VERSION_ARGS.join('|')})$`);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

// Returns the first problem found in a parsed tool list, or '' when it is fine. Each permission pattern is
// checked in checkAllow, so a pattern that is not text is reported there.
function problem(r) {
  if (!isObject(r)) return 'it must hold one JSON object';
  if (!Array.isArray(r.requires)) return 'it needs a "requires" list';
  for (const [i, t] of r.requires.entries()) {
    const at = `requires item ${i + 1}`;
    if (!isObject(t)) return `${at} must be an object`;
    if (!isText(t.name)) return `${at} needs a "name"`;
    if (!DETECT.test(t.detect)) return `${at} (${t.name}) needs a "detect" that is one program name and one of ${VERSION_ARGS.join(' ')}, for example "<tool> --version"`;
    if (!isText(t.guide)) return `${at} (${t.name}) needs a plain-language "guide"`;
    if (!isText(t.reason)) return `${at} (${t.name}) needs a one-line "reason" for the person`;
    if (t.human !== undefined && typeof t.human !== 'boolean') return `${at} (${t.name}): "human" must be true or false`;
    if (t.install !== undefined && (!isObject(t.install) || !Object.values(t.install).every((c) => c === null || isText(c)))) {
      return `${at} (${t.name}): "install" must map a platform to a command or null`;
    }
  }
  if (r.allow !== undefined && !Array.isArray(r.allow)) return '"allow" must be a list of permission patterns';
  if (r.humanSteps !== undefined && !(Array.isArray(r.humanSteps) && r.humanSteps.every(isText))) return '"humanSteps" must be a list of plain sentences';
  return '';
}

// The same text for the same content: keys sorted at every level, no whitespace.
const canonical = (v) => JSON.stringify(v, (_, x) => (isObject(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

// Loads <dir>/.ril/tools.json. Returns { tools, hash }, hash being the sha256 (hex) of the canonical form.
export function loadTools(dir) {
  const file = ownedFile(dir, 'tools.json');
  const text = readText(file);
  if (text === null) throw new RilError(`There is no tool list at ${file} yet.`, { next: 'the design stage writes it; finish that stage first' });
  let tools;
  try {
    tools = JSON.parse(text.replace(/^﻿/, ''));
  } catch (err) {
    throw new RilError(`${file} is not valid JSON.`, { next: FIX, detail: err.message });
  }
  const why = problem(tools);
  if (why) throw new RilError(`${file} is not a usable tool list: ${why}.`, { next: FIX });
  return { tools, hash: crypto.createHash('sha256').update(canonical(tools)).digest('hex') };
}

const INSIDE = 'a file rule must stay inside the project';
const RULES = [
  [/^Bash$|^Bash\(\s*(\S*[\\/])?(\*+|sh|bash|zsh|dash|ksh|fish|env|sudo)(\s|:|\)|$)/i, 'it would let any command run, or pass commands to a shell or an administrator'],
  [/^Bash\(.*\b(curl|wget)\b.*\|\s*(sudo\s+)?\w*sh\b/i, 'it would run a downloaded script'],
  [/^(Edit|Write|Read)\(\s*([\\/~]|[a-z]:)/i, `${INSIDE}; this one starts at an absolute path or the home folder`],
  [/^(Edit|Write|Read)\((.*[\\/])?\.\.([\\/)]|$)/i, `${INSIDE}; this one climbs out with ..`],
  [/^(Edit|Write)\((.*[\\/])?\.(claude|git|ril)([\\/)*]|$)/i, "ril's records, the permission settings and the git folder are never allowed"],
];

// One plain line per permission pattern that ril will not grant, whoever approved it.
export function checkAllow(patterns) {
  const lines = [];
  for (const [i, p] of patterns.entries()) {
    const why = isText(p) ? RULES.find(([re]) => re.test(p.trim()))?.[1] : 'it is not text';
    if (why) lines.push(`Permission ${i + 1} (${isText(p) ? p.trim() : JSON.stringify(p)}) is refused: ${why}.`);
  }
  return lines;
}

// The sha256 in the last decision that reads exactly `Approved tools <64 hex>`, or null.
export function approvedHash(state) {
  const hashes = state.decisions.map((d) => /^Approved tools ([0-9a-f]{64})$/.exec(String(d.decision ?? '').trim())?.[1]).filter(Boolean);
  return hashes.at(-1) ?? null;
}

// True when the detect command (a program and one version argument, see tools.mjs) finishes in time and exits 0.
// A timeout, a crash or a missing program all count as missing. No shell reads it (Windows needs one to find
// program shims, and a command that matches the pattern has nothing for a shell to interpret). It runs from the
// temp folder, not the project, so a program an agent left in the project can never stand in for the real one.
function present(detect, { env, limit }) {
  const [program, ...args] = detect.split(' ');
  const run = spawnSync(program, args, { shell: process.platform === 'win32', cwd: os.tmpdir(), env, timeout: limit, killSignal: 'SIGKILL', stdio: 'ignore', windowsHide: true });
  return !run.error && run.status === 0;
}

function line(t) {
  if (t.human === true) return `Missing: ${t.name}. Only you can install this one; here is how: ${t.guide}`;
  if (!t.install?.[process.platform]) return `Missing: ${t.name}. I have no automatic installer for this system; here is how: ${t.guide}`;
  return `Missing: ${t.name}. I can install it for you, or guide you step by step.`;
}

const preflightCommand = {
  name: 'preflight',
  summary: 'Check that the tools in the project\'s tool list are installed.',
  usage: 'ril preflight',
  run(ctx, argv) {
    const { rest } = parseFlags(argv);
    if (rest.length) throw new RilError(`ril preflight does not take ${rest[0]}; it reads the project's .ril/tools.json.`, { next: 'run: ril preflight' });
    const { tools, hash } = loadTools(ctx.dir);
    const limit = Number(ctx.env.RIL_DETECT_TIMEOUT_MS) || 60_000; // milliseconds a detect command may take
    const missing = tools.requires.filter((t) => !present(t.detect, { env: ctx.env, limit }));
    if (ctx.json) {
      ctx.out(JSON.stringify({ hash, tools: tools.requires.map((t) => ({ name: t.name, reason: t.reason })), missing: missing.map((t) => ({ name: t.name, human: t.human === true, install: t.install?.[process.platform] ?? null, guide: t.guide })) }));
    } else {
      ctx.out([`Tool list ${hash}`, ...tools.requires.map((t) => `${t.name}: ${t.reason}`), ...(missing.length ? missing.map(line) : ['Everything this project needs is installed.'])].join('\n'));
    }
    if (missing.length) ctx.exitCode = 2;
  },
};

const WRITE = 'ril allowlist write (--base | --approved) --tool claude';
const SETTINGS = '.claude/settings.json';
// What every stage needs before the tool list is approved: product files and the plugin folder (templates, rules;
// run log 2026-10-20, C2). The host writes an absolute path with a second leading slash and a drive as /c/.
const baseEntries = (root) => ['Bash(ril *)', 'Bash(git *)', 'Edit(./**)', 'Read(./**)', `Read(/${root.replace(/\\/g, '/').replace(/^(\w):/, (_, d) => `/${d.toLowerCase()}`)}/**)`];
// No worker may write ril's state, the permission settings or the git folder (its hooks) with the Edit or Write tool;
// ril writes its state and .claude/settings.json through node, and git writes .git itself. Deny rules apply at once, even before the folder is trusted,
// and beat any allow rule.
const PROTECTED = ['.ril/state.json', '.ril/state.json.bak', '.ril/state.json.damaged-*', '.ril/.lock', '.ril/.lock.break', '.claude/**', '.git/**'];
const DENY_ENTRIES = ['Edit', 'Write'].flatMap((tool) => PROTECTED.map((file) => `${tool}(${file})`));

// The settings already on disk as an object, or {} when there is no file. Anything unreadable is refused, never replaced.
function readSettings(file) {
  const refuse = (why) => new RilError(`${file} ${why}, so ril will not change it.`, { next: 'fix the file or move it out of the way, then run this again' });
  const text = readText(file);
  if (text === null) return {};
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
  const wanted = [...baseEntries(ctx.pluginRoot), ...(flags.approved ? approvedAllow(ctx.dir) : [])];

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

const allowlistCommand = {
  name: 'allowlist',
  summary: 'Write the permissions this project needs into Claude Code settings.',
  usage: WRITE,
  run: (ctx, argv) => dispatch(ctx, argv, 'allowlist', { write }),
};

export default [preflightCommand, allowlistCommand];
