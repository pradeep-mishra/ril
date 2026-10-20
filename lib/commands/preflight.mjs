import { spawnSync } from 'node:child_process';
import { RilError } from '../errors.mjs';
import { loadTools } from '../tools.mjs';
import { parseFlags } from '../args.mjs';

const DEFAULT_TIMEOUT_MS = 60_000;

function timeoutMs(env) {
  const given = env.RIL_DETECT_TIMEOUT_MS;
  if (given === undefined || given === '') return DEFAULT_TIMEOUT_MS;
  if (!/^[1-9]\d*$/.test(given)) {
    throw new RilError(`RIL_DETECT_TIMEOUT_MS is ${JSON.stringify(given)}, which is not a number of milliseconds.`, { next: 'set it to a whole number above zero, or remove it' });
  }
  return Number(given);
}

// True when the detect command (a program and one version argument, see tools.mjs) finishes in time and exits 0.
// A timeout, a crash or a missing program all count as missing. No shell reads it (Windows needs one to find
// program shims, and a command that matches the pattern has nothing for a shell to interpret).
function present(detect, { cwd, env, limit }) {
  const [program, ...args] = detect.split(' ');
  const run = spawnSync(program, args, { shell: process.platform === 'win32', cwd, env, timeout: limit, killSignal: 'SIGKILL', stdio: 'ignore', windowsHide: true });
  return !run.error && run.status === 0;
}

function line(t) {
  if (t.human === true) return `Missing: ${t.name}. Only you can install this one; here is how: ${t.guide}`;
  if (!t.install?.[process.platform]) return `Missing: ${t.name}. I have no automatic installer for this system; here is how: ${t.guide}`;
  return `Missing: ${t.name}. I can install it for you, or guide you step by step.`;
}

export default {
  name: 'preflight',
  summary: 'Check that the tools in the project\'s tool list are installed.',
  usage: 'ril preflight',
  run(ctx, argv) {
    const { rest } = parseFlags(argv);
    if (rest.length) throw new RilError(`ril preflight does not take ${rest[0]}; it reads the project's .ril/tools.json.`, { next: 'run: ril preflight' });
    const { tools, hash } = loadTools(ctx.dir);
    const limit = timeoutMs(ctx.env);
    const missing = tools.requires.filter((t) => !present(t.detect, { cwd: ctx.dir, env: ctx.env, limit }));
    if (ctx.json) {
      ctx.out(JSON.stringify({ hash, tools: tools.requires.map((t) => ({ name: t.name, reason: t.reason })), missing: missing.map((t) => ({ name: t.name, human: t.human === true, install: t.install?.[process.platform] ?? null, guide: t.guide })) }));
    } else {
      ctx.out([`Tool list ${hash}`, ...tools.requires.map((t) => `${t.name}: ${t.reason}`), ...(missing.length ? missing.map(line) : ['Everything this project needs is installed.'])].join('\n'));
    }
    if (missing.length) ctx.exitCode = 2;
  },
};
