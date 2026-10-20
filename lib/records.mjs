// Helpers shared by the commands: the flag parser, argument checks, and reading and changing the project's records.
import { RilError } from './errors.mjs';

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Runs the first word of argv as a sub-command from `subs` ({ name: (ctx, argv) => ... }).
export function dispatch(ctx, argv, command, subs) {
  const [name, ...rest] = argv;
  const sub = Object.hasOwn(subs, name ?? '') ? subs[name] : null;
  if (!sub) {
    const options = Object.keys(subs).join(', ');
    throw new RilError(name ? `ril ${command} does not know ${name}.` : `ril ${command} needs to know what to do.`, { next: `run ril ${command} with one of: ${options}` });
  }
  return sub(ctx, rest);
}

// The value of a required option, or a plain error naming it.
export function need(flags, name, usage) {
  const value = flags[name];
  if (typeof value !== 'string' || value.trim() === '') throw new RilError(`The option --${name} is missing.`, { next: `run: ${usage}` });
  return value.trim();
}

export function oneId(rest, what, usage) {
  const id = rest[0];
  if (!id) throw new RilError(`Which ${what}? No id was given.`, { next: `run: ${usage}` });
  if (!ID.test(id)) throw new RilError(`${JSON.stringify(id)} cannot be used as an id for a ${what}.`, { next: 'use letters, digits, dots, dashes or underscores, for example S1' });
  return id;
}

export function oneOf(value, allowed, what) {
  if (!allowed.includes(value)) throw new RilError(`${JSON.stringify(value)} is not a ${what} ril knows.`, { next: `use one of: ${allowed.join(', ')}` });
  return value;
}

export function find(list, id, what, listCommand) {
  const found = list.find((item) => item.id === id);
  if (!found) throw new RilError(`There is no ${what} called ${id}.`, { code: 2, next: `run ${listCommand} to see what exists` });
  return found;
}

export function say(ctx, text, data) {
  ctx.out(ctx.json ? JSON.stringify(data) : text);
}

// A list: JSON when asked, a plain line when it is empty, else one line per item.
export function show(ctx, items, none, line) {
  if (ctx.json) return ctx.out(JSON.stringify(items));
  if (!items.length) return ctx.out(none);
  for (const item of items) ctx.out(line(item));
}

// The reason given with --force, or an empty string.
export const reason = (ctx) => (typeof ctx.force === 'string' ? ctx.force.trim() : '');

export function logDecision(state, ctx, decision, why, stage = state.stage) {
  state.decisions.push({ ts: ctx.now().toISOString(), stage, decision, why });
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// True when a decision starts with `lead` (in any case) followed by the whole id `id`, exactly as written
// (so S1 does not match s1, S10 or S1.2). Only these deliberate wordings count; merely naming the id does not.
function accepted(decisions, lead, id) {
  const rest = new RegExp(`^${escape(id)}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`);
  return decisions.some((d) => {
    const text = String(d.decision ?? '').trim();
    return text.slice(0, lead.length).toLowerCase() === lead.toLowerCase() && rest.test(text.slice(lead.length));
  });
}

export const acceptedRisk = (decisions, id) => accepted(decisions, 'Accepted risk for ', id);
export const acceptedUnproven = (decisions, id) => accepted(decisions, 'Accepted as unproven: ', id);

// A value that must fit on one line.
export function oneLine(value, name, usage) {
  if (/[\r\n]/.test(value)) throw new RilError(`The option --${name} must be one line.`, { next: `run: ${usage}` });
  return value;
}

// A small flag parser: --name value, --name=value, and true/false switches.

// spec: { values: ['dir'], bools: ['json'], keepUnknown: false }
// Returns { flags, rest }; `rest` holds the words that are not flags (and unknown flags when keepUnknown is set).
export function parseFlags(argv, { values = [], bools = [], keepUnknown = false } = {}) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' && bools.includes('help')) {
      flags.help = true;
      continue;
    }
    if (!arg.startsWith('--') || arg === '--') {
      rest.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (bools.includes(name) && eq === -1) {
      flags[name] = true;
    } else if (values.includes(name)) {
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (value === undefined || (eq === -1 && value.startsWith('--'))) {
        throw new RilError(`The option --${name} needs a value.`, { next: `add a value after --${name}, or run ril help` });
      }
      flags[name] = value;
    } else if (keepUnknown) {
      rest.push(arg);
    } else {
      throw new RilError(`ril does not know the option ${arg}.`, { next: 'run ril help to see what is available' });
    }
  }
  return { flags, rest };
}
