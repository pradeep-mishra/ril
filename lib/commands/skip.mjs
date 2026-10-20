// ril skip: sets aside one stuck unit or scenario with the person's reason, so the rest of the work goes on.
import { RilError } from '../errors.mjs';
import { mutate } from '../store.mjs';
import { acceptedUnproven, logDecision, need, oneId, oneLine, say } from '../records.mjs';
import { parseFlags } from '../args.mjs';

const USAGE = 'ril skip <unit-or-scenario-id> --reason "<why>" [--unit | --scenario]';
const AFTER = 'Carrying on with the other work.';

// Which record `id` names: 'unit' or 'scenario', refusing an unknown or ambiguous id.
function pick(state, id, flags) {
  const unit = state.units.some((u) => u.id === id);
  const scenario = state.scenarios.some((s) => s.id === id);
  if (flags.unit && flags.scenario) throw new RilError('Use --unit or --scenario, not both.', { next: `run: ${USAGE}` });
  if (flags.unit && !unit) throw new RilError(`There is no unit called ${id}.`, { code: 2, next: 'run ril unit list to see what exists' });
  if (flags.scenario && !scenario) throw new RilError(`There is no scenario called ${id}.`, { code: 2, next: 'run ril scenario list to see what exists' });
  if (!unit && !scenario) throw new RilError(`There is no unit or scenario called ${id}.`, { code: 2, next: 'run ril unit list or ril scenario list to see what exists' });
  if (unit && scenario && !flags.unit && !flags.scenario) {
    throw new RilError(`${id} is both a unit and a scenario, so ril does not know which one to set aside.`, { next: `say which: ril skip ${id} --unit --reason "<why>", or ril skip ${id} --scenario --reason "<why>"` });
  }
  return flags.unit || (unit && !flags.scenario) ? 'unit' : 'scenario';
}

export default {
  name: 'skip',
  summary: 'Set aside a stuck unit or scenario, with the reason, and carry on with the rest.',
  usage: USAGE,
  run(ctx, argv) {
    const { flags, rest } = parseFlags(argv, { values: ['reason'], bools: ['unit', 'scenario'] });
    const id = oneId(rest, 'unit or scenario', USAGE);
    const why = oneLine(need(flags, 'reason', USAGE), 'reason', USAGE);
    let kind;
    let changed = true;
    const notes = [];
    mutate(ctx.dir, (s) => {
      kind = pick(s, id, flags);
      const at = ctx.now().toISOString();
      if (kind === 'unit') {
        const unit = s.units.find((u) => u.id === id);
        if (unit.state === 'parked') return void (changed = false);
        Object.assign(unit, { state: 'parked', updated: at });
        for (const a of s.agents.filter((x) => x.unit === id && x.state === 'running')) {
          notes.push(`Note: Agent ${a.id} is still working on it, and its work will not be used.\nNext: let it finish, or run ril agent set ${a.id} --state stopped`);
        }
        return logDecision(s, ctx, `Set aside unit ${id}`, why);
      }
      const scenario = s.scenarios.find((x) => x.id === id);
      if (scenario.status === 'parked' && acceptedUnproven(s.decisions, id)) return void (changed = false);
      if (scenario.status === 'proven') notes.push(`Warning: scenario ${id} was proven; that proof is set aside and no longer counts.\nNext: to count it again, have a verifier check it on the current saved version`);
      Object.assign(scenario, { status: 'parked', updated: at });
      logDecision(s, ctx, `Accepted as unproven: ${id}`, why);
    });
    const text = !changed
      ? `${kind === 'unit' ? 'Unit' : 'Scenario'} ${id} was already set aside; nothing changed. ${AFTER}`
      : kind === 'unit'
        ? `Set aside unit ${id} (${why}). ${AFTER}`
        : `Set aside scenario ${id} (${why}); it is recorded as accepted without proof and the final report will list it. ${AFTER}`;
    say(ctx, [text, ...notes].join('\n'), { id, kind, parked: true, changed, reason: why, notes });
  },
};
