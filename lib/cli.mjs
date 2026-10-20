// The ril command line: global options, finding the project, running one command, printing errors.
import path from 'node:path';
import { RilError } from './errors.mjs';
import { parseFlags } from './args.mjs';
import { findProject } from './find-project.mjs';
import { commands } from './commands/index.mjs';

function report(err, io, json) {
  const known = err instanceof RilError;
  const error = known
    ? err
    : new RilError(`ril hit an unexpected problem: ${err?.message ?? err}`, { next: 'run ril doctor --fix; if it happens again, tell whoever maintains ril', detail: String(err?.stack ?? '') });
  io.err(json ? JSON.stringify({ error: error.plain, next: error.next, detail: error.detail }) : error.message);
  return known ? error.code : 1;
}

// Runs one ril command line and returns the exit code.
export async function run(argv, io = {}) {
  const cwd = io.cwd ?? process.cwd();
  const out = io.out ?? ((text) => process.stdout.write(`${text}\n`));
  const err = io.err ?? ((text) => process.stderr.write(`${text}\n`));
  const sinks = { out, err };
  let json = false;
  try {
    const { flags, rest } = parseFlags(argv, { values: ['dir', 'force'], bools: ['json', 'help'], keepUnknown: true });
    json = Boolean(flags.json);
    const [name = 'help', ...args] = rest;
    const help = commands.find((c) => c.name === 'help');
    const command = flags.help ? help : commands.find((c) => c.name === name);
    if (!command) throw new RilError(`ril has no command called ${name}.`, { next: 'run ril help to see the list' });
    const dir = flags.dir ? path.resolve(cwd, flags.dir) : name === 'init' ? cwd : (findProject(cwd) ?? cwd);
    const ctx = { dir, cwd, json, force: flags.force ?? null, env: io.env ?? process.env, now: io.now ?? (() => new Date()), commands, out, err };
    const code = await command.run(ctx, flags.help ? rest.slice(0, 1) : args);
    return Number.isInteger(code) ? code : 0; // a command may end with its own exit code
  } catch (e) {
    return report(e, sinks, json);
  }
}
