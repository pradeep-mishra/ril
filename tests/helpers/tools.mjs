// Shared by the tool-list tests: writing .ril/tools.json, and running ril in this process so a test can set the environment.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../../lib/cli.mjs';

// Writes <dir>/.ril/tools.json: text as given, an object as it is, or a list of tools (with `extra` keys) as { requires }.
export function writeTools(dir, list, extra = {}) {
  fs.mkdirSync(path.join(dir, '.ril'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ril', 'tools.json'), typeof list === 'string' ? list : JSON.stringify(Array.isArray(list) ? { requires: list, ...extra } : list));
}

export async function rilIn(dir, args, { env = {} } = {}) {
  let stdout = '';
  let stderr = '';
  const code = await run(args, { cwd: dir, env: { ...process.env, ...env }, out: (t) => (stdout += `${t}\n`), err: (t) => (stderr += `${t}\n`) });
  return { code, stdout, stderr };
}

export async function failsIn(dir, code, args, options) {
  const r = await rilIn(dir, args, options);
  assert.equal(r.code, code, `${args.join(' ')} -> ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /Next: /, `${args.join(' ')} has no Next line`);
  return r;
}
