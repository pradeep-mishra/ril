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

// Saves everything in `dir` that the ignore files allow, and nothing outside `dir`; returns the id of the
// saved version. Creates the repository when there is none. With nothing new to save, returns the current id.
export function commitAll(dir, message) {
  if (!isRepo(dir)) run(dir, ['init', '-q']);
  run(dir, ['add', '-A', '--', '.']);
  const current = head(dir);
  const staged = run(dir, ['diff', '--cached', '--quiet', '--', '.'], { quiet: true }) === null;
  if (!staged) {
    if (current) return current;
    throw new RilError('There is nothing in the project to save yet.', { next: 'add some files to the project, then run ril checkpoint again' });
  }
  run(dir, ['commit', '-q', '-m', message, '--', '.']);
  return head(dir);
}

// Where `dir` sits inside its repository, as a prefix like "app/" ("" at the top).
export function projectPrefix(dir) {
  return run(dir, ['rev-parse', '--show-prefix']).trim();
}

// The files (relative to the top of the repository) that differ between two saved versions.
// --no-relative: a user's diff.relative setting would otherwise hide changes outside the project folder.
export function changedFiles(dir, from, to) {
  const out = run(dir, ['diff', '--no-relative', '--name-only', '--no-renames', '-z', from, to]);
  return out.split('\0').filter(Boolean);
}

// True when `older` is `newer` or one of the versions it was built on.
export function isAncestor(dir, older, newer) {
  return run(dir, ['merge-base', '--is-ancestor', older, newer], { quiet: true }) !== null;
}

// Files in `dir` (relative to the top of the repository) with changes that are not saved yet.
export function unsavedFiles(dir) {
  const out = run(dir, ['status', '--porcelain', '-z', '--untracked-files=all', '--', '.']);
  const files = [];
  const entries = out.split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    files.push(entry.slice(3));
    if (/^[RC]/.test(entry)) i++; // a rename or copy is followed by its old name
  }
  return files;
}

// True when the git program can be run at all.
export function gitInstalled(dir) {
  return run(dir, ['--version'], { quiet: true }) !== null;
}

// True when the user's git settings turn on diff.relative for this folder.
export function diffRelative(dir) {
  return run(dir, ['config', '--type=bool', '--get', 'diff.relative'], { quiet: true })?.trim() === 'true';
}
