import fs from 'node:fs';
import path from 'node:path';
import { RilError } from '../errors.mjs';
import { AGENT_STATES, ROLES, STAGES } from '../schema.mjs';
import { load, mutate } from '../store.mjs';
import { dispatch, find, need, oneId, oneLine, oneOf, parseFlags, say, show } from '../records.mjs';
import { readText } from '../safe-fs.mjs';

const REGISTER = `ril agent register <id> --role ${ROLES.join('|')} --task "<one line>" [--unit <id>] --brief <file>`;
const SET = `ril agent set <id> --state ${AGENT_STATES.join('|')} --result "<one line>" (needed for done and failed)`;
const USAGE = `${REGISTER} | ${SET} | ril agent list [--active]`;

function readBrief(ctx, given) {
  const file = path.resolve(ctx.cwd, given);
  const text = readText(file);
  if (text === null) throw new RilError(`There is no brief at ${file}.`, { code: 2, next: 'write the brief first, then run ril agent register again' });
  return { file, text };
}

// The agent's unit may be a unit id, a scenario id or a stage name.
const knows = (state, unit) => STAGES.includes(unit) || state.units.some((u) => u.id === unit) || state.scenarios.some((s) => s.id === unit);

function checkUnit(state, unit) {
  if (!knows(state, unit)) throw new RilError(`There is no unit, scenario or stage called ${unit}.`, { code: 2, next: 'run ril unit list or ril scenario list to see what exists' });
}

function register(ctx, argv) {
  const { flags, rest } = parseFlags(argv, { values: ['role', 'task', 'unit', 'brief'] });
  const id = oneId(rest, 'agent', REGISTER);
  const role = oneOf(need(flags, 'role', REGISTER), ROLES, 'role');
  const task = oneLine(need(flags, 'task', REGISTER), 'task', REGISTER);
  const brief = readBrief(ctx, need(flags, 'brief', REGISTER));
  // An input counts as a file when it is on disk: a full path, or relative to the project or the brief.
  const exists = (p) => [path.resolve(ctx.dir, p), path.resolve(path.dirname(brief.file), p)].some((f) => fs.existsSync(f));
  const given = flags.unit === undefined ? undefined : need(flags, 'unit', REGISTER);
  const at = ctx.now().toISOString();
  let agent;
  let added = true;
  mutate(ctx.dir, (s) => {
    const { fields, problems } = checkBrief(brief.text, role, { exists, knownUnit: (u) => knows(s, u) });
    if (problems.length) throw new RilError(problems.join('\n'), { code: 6, next: 'fix the brief, then run ril agent register again' });
    const unit = given ?? fields.unit;
    if (given !== undefined) checkUnit(s, unit);
    agent = { id, role, unit, task, state: 'running', result: null, started: at, updated: at };
    const same = s.agents.find((a) => a.id === id);
    if (!same) return void s.agents.push(agent);
    if (same.role !== role || same.task !== task || same.unit !== agent.unit) {
      throw new RilError(`There is already an agent called ${id} with a different job.`, { next: 'register the new agent under a new id' });
    }
    added = false;
  });
  say(ctx, added ? `Agent ${id} (${role}) is registered and working on: ${task}.` : `Agent ${id} was already registered; nothing changed.`, { ...agent, added });
}

function set(ctx, argv) {
  const { flags, rest } = parseFlags(argv, { values: ['state', 'result'] });
  const id = oneId(rest, 'agent', SET);
  const state = oneOf(need(flags, 'state', SET), AGENT_STATES, 'agent state');
  const result = flags.result === undefined ? undefined : oneLine(need(flags, 'result', SET), 'result', SET);
  if (result === undefined && (state === 'done' || state === 'failed')) {
    throw new RilError(`An agent that is ${state} must say what happened, and --result is missing.`, { next: `run: ril agent set ${id} --state ${state} --result "<one line>"` });
  }
  let agent;
  mutate(ctx.dir, (s) => {
    agent = find(s.agents, id, 'agent', 'ril agent list');
    agent.state = state;
    if (result !== undefined) agent.result = result;
    agent.updated = ctx.now().toISOString();
  });
  say(ctx, `Agent ${id} is now ${state}${agent.result ? `: ${agent.result}` : ''}.`, agent);
}

function list(ctx, argv) {
  const { flags } = parseFlags(argv, { bools: ['active'] });
  const agents = load(ctx.dir).agents.filter((a) => !flags.active || a.state === 'running');
  show(ctx, agents, flags.active ? 'No agents are working right now.' : 'No agents have been registered.', (a) => `${a.id}  ${a.role}  ${a.state}  ${a.unit}  ${a.task}${a.result ? `  (${a.result})` : ''}`);
}

const agentCommand = {
  name: 'agent',
  summary: 'Register the agents doing the work, update and list them.',
  usage: USAGE,
  run: (ctx, argv) => dispatch(ctx, argv, 'agent', { register, set, list }),
};

// Checks an agent brief: `field: value` lines, list fields as `field:` followed by `- ` items.

const LISTS = ['inputs', 'acceptance', 'touch', 'rules', 'stop'];
const FIELDS = ['role', 'unit', 'goal', 'inputs', 'acceptance', 'touch', 'rules', 'ril', 'report', 'stop'];
const MAX_LINES = 60;

const isAbsolute = (p) => path.posix.isAbsolute(p) || path.win32.isAbsolute(p);
// Without the file on disk, a path has no spaces and has a folder or an extension in it; prose does not.
const looksLikePath = (p) => !/\s/.test(p) && /[/\\.]/.test(p) && !/[,;!?]$/.test(p);

function parseBrief(text) {
  const fields = {};
  const problems = [];
  let current = null;
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const item = /^\s*-\s+(.*\S)\s*$/.exec(line);
    if (item) {
      if (current && Array.isArray(fields[current])) fields[current].push(item[1]);
      else problems.push(`Line ${i + 1} is a list item that does not belong to a list field.`);
      return;
    }
    const field = /^([A-Za-z]+):\s*(.*?)\s*$/.exec(line);
    if (!field) {
      problems.push(`Line ${i + 1} is neither a "field: value" line nor a "- " item.`);
      return;
    }
    const [, rawName, value] = field;
    const name = rawName.toLowerCase();
    if (!FIELDS.includes(name)) problems.push(`The brief has a field called ${rawName}, which ril does not know; the fields are: ${FIELDS.join(', ')}.`);
    else if (Object.hasOwn(fields, name)) problems.push(`The ${name} field appears more than once.`);
    else if (LISTS.includes(name) && value) problems.push(`The ${name} field must be a list: "${name}:" on its own line, then one "- " item per line.`);
    current = FIELDS.includes(name) && !Object.hasOwn(fields, name) ? name : null;
    if (current) fields[name] = LISTS.includes(name) ? (value ? [value] : []) : value;
  });
  return { fields, problems };
}

// Returns the brief's fields and a list of plain problems (empty when the brief is fine).
// `exists(path)` says whether an input file is on disk; `knownUnit(name)` whether the unit names something.
export function checkBrief(text, role, { exists = () => false, knownUnit = () => true } = {}) {
  const body = text.replace(/^﻿/, '');
  const count = body.split(/\r?\n/).length - (/\r?\n$/.test(body) ? 1 : 0);
  const { fields, problems } = parseBrief(body);
  if (count > MAX_LINES) problems.push(`The brief has ${count} lines; it must be at most ${MAX_LINES} lines.`);
  for (const name of FIELDS) {
    const value = fields[name];
    if (value === undefined) problems.push(`The brief has no ${name} field.`);
    else if (!value.length) problems.push(`The ${name} field is empty.`);
  }
  if (fields.role && !ROLES.includes(fields.role)) problems.push(`The role field says ${fields.role}; it must be one of: ${ROLES.join(', ')}.`);
  else if (fields.role && fields.role !== role) problems.push(`The role field says ${fields.role}, but the agent is being registered as ${role}.`);
  if (fields.report && fields.report !== 'agent-report') problems.push(`The report field says ${fields.report}; it must say agent-report.`);
  if (fields.rules?.length && (fields.rules.length !== 2 || !fields.rules.every(isAbsolute))) {
    problems.push('The rules field must list exactly two full paths (starting from the top of the disk): the worker rules, then the principles.');
  }
  if (fields.unit && !knownUnit(fields.unit)) problems.push(`The unit field says ${fields.unit}, but there is no unit, scenario or stage with that name.`);
  for (const input of fields.inputs ?? []) {
    if (!exists(input) && !looksLikePath(input)) problems.push(`The inputs field must list file paths only; "${input}" is not a file in the project and does not look like a file path. Name the file to read instead of describing it.`);
  }
  return { fields, problems };
}

export default [agentCommand];
