import fs from 'node:fs';
import { RilError, noProjectError } from '../errors.mjs';
import { load, statePath } from '../store.mjs';
import { parseFlags } from '../records.mjs';
import { changedLine } from '../proof.mjs';
import { appendOwned } from '../safe-fs.mjs';

// Plain-language views of the project state: one line, and the full status page.
const STAGE_LABEL = {
  shape: 'Shaping the idea (shape stage)',
  design: 'Designing the plans (design stage)',
  confirm: 'Waiting for your approval (confirm stage)',
  accept: 'Final checks (accept stage)',
  done: 'Done',
};

const UNIT_WORDS = { todo: 'not started', doing: 'in progress', built: 'built', verified: 'proven', failed: 'needs a fix', parked: 'set aside' };

function scenarioWords(sc, cap) {
  if (sc.status === 'proven') return 'proven';
  if (sc.status === 'parked') return 'set aside';
  if (sc.status === 'failing') return sc.round > 0 ? `failing (fix round ${sc.round} of ${cap})` : 'failing';
  return 'not proven yet';
}

const AGENT_WORDS = { registered: 'not started', running: 'working', done: 'finished', failed: 'failed', stopped: 'stopped' };

// The numbers behind the status line.
function summarise(state) {
  const plans = state.units.filter((u) => u.kind === 'plan');
  const open = (u) => !['verified', 'parked'].includes(u.state);
  const current = plans.find((u) => u.state === 'doing') ?? plans.find(open);
  const count = (status) => state.scenarios.filter((s) => s.status === status).length;
  const rounds = state.scenarios.filter((s) => s.status !== 'proven' && s.status !== 'parked').map((s) => s.round || 0);
  return {
    stage: state.stage,
    plan: plans.length ? { n: current ? plans.indexOf(current) + 1 : plans.length, of: plans.length } : null,
    scenarios: { total: state.scenarios.length, proven: count('proven'), failing: count('failing'), parked: count('parked') },
    round: Math.max(0, ...rounds),
    cap: state.cap,
    openQuestions: state.gates.filter((g) => g.status === 'open').length,
  };
}

function stageLabel(state, sum) {
  if (state.stage === 'build') return sum.plan ? `Building plan ${sum.plan.n} of ${sum.plan.of}` : 'Building';
  if (state.stage === 'parked') return `Paused (it was in the ${state.parkedFrom} stage)`;
  return STAGE_LABEL[state.stage];
}

export function oneline(state, sum = summarise(state)) {
  const { total, proven, failing, parked } = sum.scenarios;
  let progress = 'no scenarios yet';
  if (total) {
    progress = `${proven} of ${total} scenarios proven`;
    if (failing) progress += `, ${failing} failing`;
    if (parked) progress += `, ${parked} set aside`;
    if (sum.round) progress += ` (round ${sum.round} of ${sum.cap})`;
  }
  const waiting = sum.openQuestions ? `${sum.openQuestions} open question${sum.openQuestions === 1 ? '' : 's'}` : 'nothing';
  return `${stageLabel(state, sum)}: ${progress}. Waiting on you: ${waiting}.`;
}

function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd());
}

export function full(state) {
  const sum = summarise(state);
  const out = [`Project: ${state.project} (${state.mode} mode)`, oneline(state, sum), ''];
  out.push('Scenarios:');
  if (state.scenarios.length) {
    out.push(...state.scenarios.map((sc) => `  ${sc.id}  ${sc.title} - ${scenarioWords(sc, state.cap)}`), '');
  } else {
    out.push('  No scenarios yet.', '');
  }
  const plans = state.units.filter((u) => u.kind === 'plan');
  if (plans.length) {
    out.push('Plans:', ...plans.map((p) => `  ${p.title} - ${UNIT_WORDS[p.state] ?? p.state}`), '');
  }
  out.push('Agents:');
  if (state.agents.length) {
    const rows = [['Role', 'Working on', 'State', 'Result']];
    for (const a of state.agents) rows.push([a.role, a.task || a.unit || '-', AGENT_WORDS[a.state] ?? a.state, a.result || '-']);
    out.push(...table(rows).map((l) => `  ${l}`));
  } else {
    out.push('  No agents have been started.');
  }
  return `${out.join('\n')}\n`;
}

const statusCommand = {
  name: 'status',
  summary: 'Show where the project stands (--full for the details).',
  usage: 'ril status [--full]',
  run(ctx, argv) {
    const { flags } = parseFlags(argv, { bools: ['full'] });
    const state = load(ctx.dir);
    const line = oneline(state);
    if (flags.full && !ctx.json) {
      const changed = changedLine(ctx.dir, state.seals);
      return ctx.out(full(state).trimEnd() + (changed ? `\n${changed}` : ''));
    }
    ctx.out(ctx.json ? JSON.stringify({ summary: line, ...summarise(state) }) : line);
  },
};

const progressCommand = {
  name: 'progress',
  summary: 'Add a line to the project progress log and show it.',
  usage: 'ril progress "<line>"',
  run(ctx, argv) {
    const line = argv.join(' ').replace(/\s*[\r\n]+\s*/g, ' ').trim();
    if (!line) throw new RilError('There is no progress line to record.', { next: 'run ril progress "what just happened"' });
    if (!fs.existsSync(statePath(ctx.dir))) throw noProjectError(ctx.dir);
    appendOwned(ctx.dir, 'log.md', `${ctx.now().toISOString()}\t${line}\n`);
    ctx.out(ctx.json ? JSON.stringify({ line }) : line);
  },
};

const helpCommand = {
  name: 'help',
  summary: 'List the commands, or show how to use one.',
  usage: 'ril help [command]',
  run(ctx, argv) {
    const [which] = argv;
    if (which) {
      const found = ctx.commands.find((c) => c.name === which);
      if (!found) throw new RilError(`There is no command called ${which}.`, { next: 'run ril help to see the list' });
      return ctx.out(ctx.json ? JSON.stringify({ name: found.name, summary: found.summary, usage: found.usage }) : `${found.summary}\nUsage: ${found.usage}`);
    }
    if (ctx.json) return ctx.out(JSON.stringify({ commands: ctx.commands.map(({ name, summary }) => ({ name, summary })) }));
    const width = Math.max(...ctx.commands.map((c) => c.name.length));
    ctx.out(['ril keeps track of a project from idea to proven software.', '', ...ctx.commands.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`), '', 'Options for every command: --dir <folder>, --json, --force "<reason>".'].join('\n'));
  },
};

export default [statusCommand, progressCommand, helpCommand];
