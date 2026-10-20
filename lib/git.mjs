// The few git operations ril needs. Always an argument list, never a shell string.
import { execFileSync } from 'node:child_process';
import { RilError } from './errors.mjs';

const ID = /^[0-9a-f]{7,40}$/i;

function run(dir, args, { quiet = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch (err) {
    if (quiet) return null;
    if (err.code === 'ENOENT') throw new RilError('git is not installed, or ril cannot find it.', { next: 'install git, then try again', detail: err.message });
    const said = String(err.stderr ?? err.message).trim();
    if (/user\.(name|email)|identity unknown|tell me who you are/i.test(said)) {
      throw new RilError('git does not know whose name to put on the saved version.', { next: 'set your name and email with git config user.name and git config user.email, then try again', detail: said });
    }
    throw new RilError('git could not do what ril asked.', { next: 'run git status in the project folder to see what is wrong, then try again', detail: said });
  }
}

export function isRepo(dir) {
  return run(dir, ['rev-parse', '--is-inside-work-tree'], { quiet: true })?.trim() === 'true';
}

// The id of the current saved version, or null when nothing has been saved yet.
export function head(dir) {
  if (!isRepo(dir)) return null;
  return run(dir, ['rev-parse', '--verify', '-q', 'HEAD'], { quiet: true })?.trim() || null;
}

// The full id of the saved version `ref` (7 to 40 hex characters), or null when there is no such version.
export function resolve(dir, ref) {
  if (!ID.test(ref ?? '') || !isRepo(dir)) return null;
  return run(dir, ['rev-parse', '--verify', '-q', `${ref.toLowerCase()}^{commit}`], { quiet: true })?.trim() || null;
}

export const looksLikeId = (ref) => ID.test(ref ?? '');

// Saves everything in `dir` that the ignore files allow; returns the id of the saved version.
// Creates the repository when there is none. With nothing new to save, returns the current version.
export function commitAll(dir, message) {
  if (!isRepo(dir)) run(dir, ['init', '-q']);
  run(dir, ['add', '-A', '--', '.']);
  const current = head(dir);
  const staged = run(dir, ['diff', '--cached', '--quiet'], { quiet: true }) === null;
  if (current && !staged) return current;
  run(dir, ['commit', '-q', ...(staged ? [] : ['--allow-empty']), '-m', message]);
  return head(dir);
}

// The files (relative to `dir`) that differ between two saved versions.
export function changedFiles(dir, from, to) {
  const out = run(dir, ['diff', '--name-only', '--no-renames', '--relative', '-z', from, to, '--']);
  return out.split('\0').filter(Boolean);
}
