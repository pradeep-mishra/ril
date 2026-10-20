import { spawnSync } from 'node:child_process';
import { RilError } from '../errors.mjs';
import { expandRecipe, loadRecipe } from '../recipe.mjs';
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
// {recipe} in the command is the quoted recipe folder; RIL_RECIPE_DIR holds the same folder for commands that prefer it.
function present(detect, dir, { cwd, env, limit }) {
  const run = spawnSync(expandRecipe(detect, dir), { shell: true, cwd, env: { ...env, RIL_RECIPE_DIR: dir }, timeout: limit, killSignal: 'SIGKILL', stdio: 'ignore', windowsHide: true });
  return !run.error && run.status === 0;
}

function line(t) {
  if (t.human === true) return `Missing: ${t.name}. Only you can install this one; here is how: ${t.guide}`;
  if (!t.install?.[process.platform]) return `Missing: ${t.name}. I have no automatic installer for this system; here is how: ${t.guide}`;
  return `Missing: ${t.name}. I can install it for you, or guide you step by step.`;
}

export default {
  name: 'preflight',
  summary: 'Check that the tools a recipe needs are installed.',
  usage: USAGE,
  run(ctx, argv) {
    const { rest } = parseFlags(argv);
    const { dir, recipe } = loadRecipe(rest[0], ctx.cwd, ctx.recipeRoot);
    const limit = timeoutMs(ctx.env);
    const missing = recipe.requires.filter((t) => !present(t.detect, dir, { cwd: ctx.cwd, env: ctx.env, limit }));
    if (ctx.json) {
      ctx.out(JSON.stringify({ missing: missing.map((t) => ({ name: t.name, human: t.human === true, install: t.install?.[process.platform] ?? null, guide: t.guide })) }));
    } else if (!missing.length) {
      ctx.out('Everything this project needs is installed.');
    } else {
      for (const t of missing) {
        ctx.out(line(t));
      }
    }
    if (missing.length) ctx.exitCode = 2;
  },
};
