import fs from 'node:fs';
import path from 'node:path';
import { RilError } from '../errors.mjs';
import { AGENT_STATES, ROLES, STAGES } from '../schema.mjs';
import { load, mutate } from '../store.mjs';
import { dispatch, find, need, oneId, oneLine, oneOf, say } from '../records.mjs';
import { parseFlags } from '../args.mjs';
import { checkBrief } from '../brief.mjs';

const REGISTER = `ril agent register <id> --role ${ROLES.join('|')} --task "<one line>" [--unit <id>] --brief <file>`;
const SET = `ril agent set <id> --state ${AGENT_STATES.join('|')} [--result "<one line>"]`;
const USAGE = `${REGISTER} | ${SET} | ril agent list [--active]`;

function readBrief(ctx, given) {
  const file = path.resolve(ctx.cwd, given);
  try {
    return { file, text: fs.readFileSync(file, 'utf8') };
  } catch (err) {
    if (err.code === 'ENOENT') throw new RilError(`There is no brief at ${file}.`, { code: 2, next: 'write the brief first, then run ril agent register again' });
    throw new RilError(`Could not read the brief at ${file}.`, { next: 'check the file can be read, then try again', detail: err.message });
  }
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
  if (ctx.json) return ctx.out(JSON.stringify(agents));
  if (!agents.length) return ctx.out(flags.active ? 'No agents are working right now.' : 'No agents have been registered.');
  for (const a of agents) ctx.out(`${a.id}  ${a.role}  ${a.state}  ${a.unit}  ${a.task}${a.result ? `  (${a.result})` : ''}`);
}

export default {
  name: 'agent',
  summary: 'Register the agents doing the work, update and list them.',
  usage: USAGE,
  run: (ctx, argv) => dispatch(ctx, argv, 'agent', { register, set, list }),
};
