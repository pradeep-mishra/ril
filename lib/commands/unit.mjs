import { RilError } from '../errors.mjs';
import { UNIT_KINDS, UNIT_STATES } from '../schema.mjs';
import { load, mutate } from '../store.mjs';
import { dispatch, find, need, oneId, oneOf, say } from '../records.mjs';
import { parseFlags } from '../args.mjs';

const ADD = 'ril unit add <id> --kind plan|task [--parent <id>] --title <text>';
const SET = 'ril unit set <id> --state todo|doing|built|verified|failed|parked [--checkpoint <text>]';
const USAGE = `${ADD} | ${SET} | ril unit list [--state <state>] [--kind <kind>]`;

function add(ctx, argv) {
  const { flags, rest } = parseFlags(argv, { values: ['kind', 'parent', 'title'] });
  const id = oneId(rest, 'unit', ADD);
  const kind = oneOf(need(flags, 'kind', ADD), UNIT_KINDS, 'kind of unit');
  const title = need(flags, 'title', ADD);
  let unit;
  mutate(ctx.dir, (s) => {
    if (s.units.some((u) => u.id === id)) throw new RilError(`There is already a unit called ${id}.`, { next: `use ril unit set ${id} to change it` });
    if (flags.parent) find(s.units, flags.parent, 'unit', 'ril unit list');
    unit = { id, kind, parent: flags.parent ?? null, title, state: 'todo', checkpoint: null, updated: ctx.now().toISOString() };
    s.units.push(unit);
  });
  say(ctx, `Added ${kind} ${id}: ${title}.`, unit);
}

function set(ctx, argv) {
  const { flags, rest } = parseFlags(argv, { values: ['state', 'checkpoint'] });
  const id = oneId(rest, 'unit', SET);
  if (flags.state === undefined && flags.checkpoint === undefined) throw new RilError('There is nothing to change.', { next: `run: ${SET}` });
  if (flags.state !== undefined) oneOf(flags.state, UNIT_STATES, 'state');
  let unit;
  mutate(ctx.dir, (s) => {
    unit = find(s.units, id, 'unit', 'ril unit list');
    if (flags.state !== undefined) unit.state = flags.state;
    if (flags.checkpoint !== undefined) unit.checkpoint = flags.checkpoint;
    unit.updated = ctx.now().toISOString();
  });
  const warning = unit.state === 'verified' && !unit.checkpoint
    ? `Warning: ${id} is marked proven without a checkpoint, so nothing says which version was checked. Next: run ril unit set ${id} --state verified --checkpoint <checkpoint>`
    : null;
  if (warning && !ctx.json) ctx.err(warning);
  say(ctx, `${id} is now ${unit.state}.`, { ...unit, warning });
}

function list(ctx, argv) {
  const { flags } = parseFlags(argv, { values: ['state', 'kind'] });
  const units = load(ctx.dir).units.filter((u) => (!flags.state || u.state === flags.state) && (!flags.kind || u.kind === flags.kind));
  if (ctx.json) return ctx.out(JSON.stringify(units));
  if (!units.length) return ctx.out('There are no units to show.');
  for (const u of units) ctx.out(`${u.id}  ${u.kind}  ${u.state}  ${u.title}`);
}

export default {
  name: 'unit',
  summary: 'Add, update and list the plans and tasks.',
  usage: USAGE,
  run: (ctx, argv) => dispatch(ctx, argv, 'unit', { add, set, list }),
};
