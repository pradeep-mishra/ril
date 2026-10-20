import { spawnSync } from 'node:child_process';
import { RilError } from '../errors.mjs';
import { loadRecipe } from '../recipe.mjs';
import { parseFlags } from '../args.mjs';

const USAGE = 'ril preflight <recipe-folder>';
const DEFAULT_TIMEOUT_MS = 60_000;

function timeoutMs(env) {
  const given = env.RIL_DETECT_TIMEOUT_MS;
  if (given === undefined || given === '') return DEFAULT_TIMEOUT_MS;
  if (!/^[1-9]\d*$/.test(given)) {
    throw new RilError(`RIL_DETECT_TIMEOUT_MS is ${JSON.stringify(given)}, which is not a number of milliseconds.`, { next: 'set it to a whole number above zero, or remove it' });
  }
  return Number(given);
}

// True when the detect command finishes in time and exits 0. A timeout, a crash or a missing program all count as missing.
// The command runs through the platform shell because recipe authors write detect commands for a shell.
// A recipe comes from the plugin or from someone the person chose to trust, so its commands are trusted too.
function present(detect, { cwd, env, limit }) {
  const run = spawnSync(detect, { shell: true, cwd, env, timeout: limit, killSignal: 'SIGKILL', stdio: 'ignore', windowsHide: true });
  return !run.error && run.status === 0;
}

export default {
  name: 'preflight',
  summary: 'Check that the tools a recipe needs are installed.',
  usage: USAGE,
  run(ctx, argv) {
    const { rest } = parseFlags(argv);
    const { dir, recipe } = loadRecipe(rest[0], ctx.cwd);
    const limit = timeoutMs(ctx.env);
    const missing = recipe.requires.filter((t) => !present(t.detect.replaceAll('{recipe}', dir), { cwd: ctx.cwd, env: ctx.env, limit }));
    if (ctx.json) {
      ctx.out(JSON.stringify({ missing: missing.map((t) => ({ name: t.name, human: t.human === true, install: t.install?.[process.platform] ?? null, guide: t.guide })) }));
    } else if (!missing.length) {
      ctx.out('Everything this project needs is installed.');
    } else {
      for (const t of missing) {
        ctx.out(t.human === true ? `Missing: ${t.name}. Only you can install this one; here is how: ${t.guide}` : `Missing: ${t.name}. I can install it for you, or guide you step by step.`);
      }
    }
    return missing.length ? 2 : 0;
  },
};
