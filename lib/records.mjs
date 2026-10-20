// Small helpers shared by the commands that read and change the project's records.
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

// The reason given with --force, or an empty string.
export const reason = (ctx) => (typeof ctx.force === 'string' ? ctx.force.trim() : '');

export function logDecision(state, ctx, decision, why, stage = state.stage) {
  state.decisions.push({ ts: ctx.now().toISOString(), stage, decision, why });
}

// True when a recorded decision names `id` (as a whole id, so S1 does not match S10 or S1.2).
export function mentions(decisions, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const named = new RegExp(`(?<![A-Za-z0-9._-])${escaped}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`);
  return decisions.some((d) => named.test(`${d.decision}\n${d.why}`));
}

// A value that must fit on one line.
export function oneLine(value, name, usage) {
  if (/[\r\n]/.test(value)) throw new RilError(`The option --${name} must be one line.`, { next: `run: ${usage}` });
  return value;
}
