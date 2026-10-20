import fs from 'node:fs';
import path from 'node:path';
import { RilError } from '../errors.mjs';
import { METHODS, SCENARIO_STATUSES, STAGES } from '../schema.mjs';
import { load, mutate } from '../store.mjs';
import { dispatch, find, logDecision, need, oneId, oneOf, reason, say } from '../records.mjs';
import { parseFlags } from '../args.mjs';
import { parseSpec } from '../spec-import.mjs';

const ADD = 'ril scenario add <id> --title <text> --method ui|api|cli|golden --criterion <text>';
const UPDATE = 'ril scenario update <id> [--title <text>] [--criterion <text>] [--method <method>]';
const IMPORT = 'ril scenario import <spec.md> [--check]';
const USAGE = `${ADD} | ${UPDATE} | ril scenario list [--status <status>] | ril scenario coverage | ${IMPORT}`;

const now = (ctx) => ctx.now().toISOString();

function add(ctx, argv) {
  const { flags, rest } = parseFlags(argv, { values: ['title', 'method', 'criterion'] });
  const id = oneId(rest, 'scenario', ADD);
  const title = need(flags, 'title', ADD);
  const method = oneOf(need(flags, 'method', ADD), METHODS, 'way of proving');
  const criterion = need(flags, 'criterion', ADD);
  let added = true;
  mutate(ctx.dir, (s) => {
    const same = s.scenarios.find((x) => x.id === id);
    if (same) {
      if (same.title !== title || same.method !== method || same.criterion !== criterion) {
        throw new RilError(`Scenario ${id} already exists with different wording.`, { next: `use scenario update ${id} to change it` });
      }
      added = false;
      return;
    }
    s.scenarios.push({ id, title, method, criterion, status: 'unproven', round: 0, updated: now(ctx) });
  });
  say(ctx, added ? `Added scenario ${id}: ${title}.` : `Scenario ${id} was already there; nothing changed.`, { id, added });
}

// Rail 3 and tried scenarios: once the person has confirmed the plan, or once a scenario has been tried,
// changing it needs one --force reason (logged once). A changed pass condition voids the old result.
function update(ctx, argv) {
  const { flags, rest } = parseFlags(argv, { values: ['title', 'method', 'criterion'] });
  const id = oneId(rest, 'scenario', UPDATE);
  const changes = {};
  for (const key of ['title', 'criterion', 'method']) if (flags[key] !== undefined) changes[key] = need(flags, key, UPDATE);
  if (!Object.keys(changes).length) throw new RilError('There is nothing to change.', { next: `run: ${UPDATE}` });
  if (changes.method !== undefined) oneOf(changes.method, METHODS, 'way of proving');
  mutate(ctx.dir, (s) => {
    const scenario = find(s.scenarios, id, 'scenario', 'ril scenario list');
    const frozen = ['criterion', 'method'].filter((k) => changes[k] !== undefined && changes[k] !== scenario[k]);
    const at = s.stage === 'parked' ? s.parkedFrom : s.stage;
    const locked = frozen.length && STAGES.indexOf(at) > STAGES.indexOf('confirm');
    const tried = scenario.status !== 'unproven';
    if ((locked || tried) && !reason(ctx)) {
      const because = tried
        ? `Scenario ${id} has already been tried (it is ${scenario.status}), so changing it throws that result away.`
        : `The person already confirmed the plan, so the ${frozen.join(' and ')} of scenario ${id} is locked.`;
      throw new RilError(because, { next: `if it must change, run ril scenario update ${id} ... --force "<why>"` });
    }
    if (locked || tried) {
      const what = frozen.length ? frozen.join(' and ') : 'wording';
      logDecision(s, ctx, `Changed the ${what} of scenario ${id}${tried ? ` after it was ${scenario.status}` : ' after the plan was confirmed'}`, reason(ctx));
    }
    Object.assign(scenario, changes, { updated: now(ctx) });
    if (tried && frozen.length) Object.assign(scenario, { status: 'unproven', round: 0 });
  });
  say(ctx, `Updated scenario ${id}.`, { id, ...changes });
}

function list(ctx, argv) {
  const { flags } = parseFlags(argv, { values: ['status'] });
  if (flags.status) oneOf(flags.status, SCENARIO_STATUSES, 'status');
  const scenarios = load(ctx.dir).scenarios.filter((s) => !flags.status || s.status === flags.status);
  if (ctx.json) return ctx.out(JSON.stringify(scenarios));
  if (!scenarios.length) return ctx.out('There are no scenarios to show.');
  for (const s of scenarios) ctx.out(`${s.id}  ${s.status}  ${s.method}  ${s.title}`);
}

// Every scenario needs a feature map whose first line says how it is proven.
function coverage(ctx) {
  const { scenarios } = load(ctx.dir);
  if (!scenarios.length) return say(ctx, 'There are no scenarios yet, so nothing needs a feature map.', { missing: [] });
  const folder = path.join(ctx.dir, '.ril', 'docs', 'verification', 'feature-map');
  const missing = [];
  for (const s of scenarios) {
    const file = path.join(folder, `${s.id}.md`);
    let first;
    try {
      first = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0];
    } catch (err) {
      if (err.code !== 'ENOENT') throw new RilError(`Could not read ${file}.`, { next: 'check the file can be read, then try again', detail: err.message });
      missing.push(`Scenario ${s.id} has no feature map yet (expected ${path.relative(ctx.dir, file)}).`);
      continue;
    }
    const says = /^Method:\s*(\S+)\s*$/i.exec(first)?.[1]?.toLowerCase();
    if (says !== s.method) missing.push(`The feature map for scenario ${s.id} should start with "Method: ${s.method}"${says ? `, but says ${says}` : ''}.`);
  }
  if (missing.length) throw new RilError(missing.join('\n'), { code: 2, next: 'write each missing feature map, then run ril scenario coverage again' });
  say(ctx, `Every one of the ${scenarios.length} scenarios has a feature map.`, { missing: [] });
}

// Problems with importing `found` into `state`, and the scenarios that are new.
function plan(state, found) {
  const problems = [];
  const fresh = [];
  for (const s of found) {
    const have = state.scenarios.find((x) => x.id === s.id);
    if (!have) fresh.push(s);
    else if (have.title !== s.title || have.method !== s.method || have.criterion !== s.criterion) {
      problems.push(`${s.id} is already in the project with different wording; use scenario update ${s.id} to change it.`);
    }
  }
  return { problems, fresh };
}

const importProblems = (problems) => new RilError(problems.join('\n'), { code: 6, next: 'fix the spec, then run ril scenario import again' });

function importSpec(ctx, argv) {
  const { flags, rest } = parseFlags(argv, { bools: ['check'] });
  if (!rest[0]) throw new RilError('Which spec file? No file was given.', { next: `run: ${IMPORT}` });
  const file = path.resolve(ctx.cwd, rest[0]);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new RilError(`There is no spec file at ${file}.`, { code: 2, next: 'check the path, then run ril scenario import again' });
    throw new RilError(`Could not read the spec at ${file}.`, { next: 'check the file can be read, then try again', detail: err.message });
  }
  const { scenarios, problems } = parseSpec(text);
  const total = scenarios.length;
  if (flags.check) {
    const clashes = problems.length ? [] : plan(load(ctx.dir), scenarios).problems;
    if (problems.length || clashes.length) throw importProblems([...problems, ...clashes]);
    return say(ctx, `The spec is fine: ${total} scenarios found. Nothing was added.`, { scenarios: total, added: 0 });
  }
  if (problems.length) throw importProblems(problems);
  let added = 0;
  mutate(ctx.dir, (s) => {
    const { problems: clashes, fresh } = plan(s, scenarios);
    if (clashes.length) throw importProblems(clashes);
    for (const f of fresh) s.scenarios.push({ ...f, status: 'unproven', round: 0, updated: now(ctx) });
    added = fresh.length;
  });
  const already = total - added;
  say(ctx, `Added ${added} scenarios from ${path.basename(file)}${already ? ` (${already} were already there)` : ''}.`, { scenarios: total, added });
}

export default {
  name: 'scenario',
  summary: 'Add, change, list, check and import the scenarios to prove.',
  usage: USAGE,
  run: (ctx, argv) => dispatch(ctx, argv, 'scenario', { add, update, list, coverage, import: importSpec }),
};
