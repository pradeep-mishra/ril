import path from 'node:path';
import { RilError } from '../errors.mjs';
import { METHODS, STAGES } from '../schema.mjs';
import { load, mutate } from '../store.mjs';
import { dispatch, find, logDecision, need, oneId, oneOf, parseFlags, reason, say, show } from '../records.mjs';
import { readText } from '../safe-fs.mjs';

// Reads the scenarios out of a spec written in the ril spec shape.

const HEADING = /^#{1,6}\s/;
const SCENARIO = /^###\s+(S\d+)\s*:\s*(.*?)\s*$/;
const LOOKS_LIKE_SCENARIO = /^###\s+S\d/i;
const FIELD = /^\s*(?:[-*]\s+)?(Criterion|Proof)\s*:\s*(.*?)\s*$/i;

// Returns { scenarios: [{ id, title, criterion, method }], problems: [plain line, ...] }.
function parseSpec(text) {
  const problems = [];
  const blocks = [];
  let block = null;
  let wrapping = false; // the criterion carries on over the next non-blank lines
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (wrapping && line.trim() && !HEADING.test(line) && !FIELD.test(line)) {
      block.criterion += ` ${line.trim()}`;
      continue;
    }
    wrapping = false;
    if (HEADING.test(line)) {
      const match = SCENARIO.exec(line);
      block = match ? { id: match[1], title: match[2], criterion: '', proof: '' } : null;
      if (block) blocks.push(block);
      else if (LOOKS_LIKE_SCENARIO.test(line)) problems.push(`The heading "${line.trim()}" should look like "### S1: a short title".`);
      continue;
    }
    const field = block && FIELD.exec(line);
    if (field) {
      const key = field[1].toLowerCase() === 'proof' ? 'proof' : 'criterion';
      if (!block[key]) {
        block[key] = field[2];
        wrapping = key === 'criterion' && Boolean(field[2]);
      }
    }
  }
  const seen = new Set();
  const scenarios = [];
  for (const b of blocks) {
    const where = b.id;
    if (seen.has(b.id)) problems.push(`${where} appears more than once in the spec.`);
    seen.add(b.id);
    if (!b.title) problems.push(`${where} has no title after the colon.`);
    if (!b.criterion) problems.push(`${where} has no "Criterion:" line saying what must be true.`);
    const method = b.proof.toLowerCase();
    if (!b.proof) problems.push(`${where} has no "Proof:" line saying how it will be proven (${METHODS.join(', ')}).`);
    else if (!METHODS.includes(method)) problems.push(`${where} says Proof: ${b.proof}, but the proof must be one of ${METHODS.join(', ')}.`);
    scenarios.push({ id: b.id, title: b.title, criterion: b.criterion, method });
  }
  if (!blocks.length && !problems.length) problems.push('The spec has no scenarios; each one starts with a heading like "### S1: a short title".');
  return { scenarios, problems };
}

const ADD = 'ril scenario add <id> --title <text> --method ui|api|cli|golden --criterion <text>';
const UPDATE = 'ril scenario update <id> [--title <text>] [--criterion <text>] [--method <method>]';
const IMPORT = 'ril scenario import <spec.md> [--check]';
const USAGE = `${ADD} | ${UPDATE} | ril scenario list | ril scenario coverage | ${IMPORT}`;

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

function list(ctx) {
  show(ctx, load(ctx.dir).scenarios, 'There are no scenarios to show.', (s) => `${s.id}  ${s.status}  ${s.method}  ${s.title}`);
}

// Every scenario needs a feature map whose first line says how it is proven.
function coverage(ctx) {
  const { scenarios } = load(ctx.dir);
  if (!scenarios.length) return say(ctx, 'There are no scenarios yet, so nothing needs a feature map.', { missing: [] });
  const folder = path.join(ctx.dir, '.ril', 'docs', 'verification', 'feature-map');
  const missing = [];
  for (const s of scenarios) {
    const file = path.join(folder, `${s.id}.md`);
    const text = readText(file);
    if (text === null) {
      missing.push(`Scenario ${s.id} has no feature map yet (expected ${path.relative(ctx.dir, file)}).`);
      continue;
    }
    const first = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0];
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
  const text = readText(file);
  if (text === null) throw new RilError(`There is no spec file at ${file}.`, { code: 2, next: 'check the path, then run ril scenario import again' });
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

const scenarioCommand = {
  name: 'scenario',
  summary: 'Add, change, list, check and import the scenarios to prove.',
  usage: USAGE,
  run: (ctx, argv) => dispatch(ctx, argv, 'scenario', { add, update, list, coverage, import: importSpec }),
};

const ROUND_USAGE = 'ril round bump <scenario> | ril round reset <scenario> --force "<reason>"';

function change(apply) {
  return (ctx, argv) => {
    const { rest } = parseFlags(argv);
    const id = oneId(rest, 'scenario', ROUND_USAGE);
    let result;
    mutate(ctx.dir, (s) => {
      const scenario = find(s.scenarios, id, 'scenario', 'ril scenario list');
      result = apply(scenario, s, ctx);
      scenario.updated = ctx.now().toISOString();
    });
    say(ctx, result.text, { scenario: id, round: result.round });
  };
}

// The cap is a hard stop: nothing is stored and --force does not move it.
const bump = change((scenario, state) => {
  const round = (scenario.round || 0) + 1;
  if (round > state.cap) {
    throw new RilError(`Scenario ${scenario.id} has used all ${state.cap} fix rounds and is still not proven.`, { code: 4, next: 'stop and write the stop report' });
  }
  scenario.round = round;
  return { round, text: `Scenario ${scenario.id} is now in fix round ${round} of ${state.cap}.` };
});

// Starting the count again undoes the cap, so it needs the person's reason, which is logged.
const reset = change((scenario, state, ctx) => {
  const why = reason(ctx);
  if (!why) {
    throw new RilError(`Starting scenario ${scenario.id} again from round 0 takes away the limit on fix rounds, so it needs a reason.`, { next: `only if the person agreed, run ril round reset ${scenario.id} --force "<reason>"` });
  }
  logDecision(state, ctx, `Started scenario ${scenario.id} again from round 0 (it was at round ${scenario.round || 0})`, why);
  scenario.round = 0;
  return { round: 0, text: `Scenario ${scenario.id} starts again from round 0.` };
});

const roundCommand = {
  name: 'round',
  summary: 'Count fix rounds for a scenario, up to the limit.',
  usage: ROUND_USAGE,
  run: (ctx, argv) => dispatch(ctx, argv, 'round', { bump, reset }),
};

export default [scenarioCommand, roundCommand];
