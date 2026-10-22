// The few git operations ril needs. Always an argument list, never a shell string.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { RilError } from './errors.mjs';

const ID = /^[0-9a-f]{7,40}$/i;
// Project-local on purpose: it must not change the person's settings for other projects.
const IDENTITY = 'run these two commands inside your project folder, with your own name and email (this only affects this project): git config user.name "Your Name" and git config user.email "you@example.com", then try again';

function run(dir, args, { quiet = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch (err) {
    if (quiet) return null;
    if (err.code === 'ENOENT') throw new RilError('git is not installed, or ril cannot find it.', { next: 'install git, then try again', detail: err.message });
    const said = String(err.stderr ?? err.message).trim();
    if (/user\.(name|email)|identity unknown|tell me who you are/i.test(said)) {
      throw new RilError('git does not know whose name to put on the saved version.', { next: IDENTITY, detail: said });
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

// Keeps ril's own folder and Finder and Explorer files out of saved versions via the repository's own exclude file,
// so documents, evidence and state never change the saved version. Safe to repeat.
export function ignoreLocal(dir) {
  const file = path.resolve(dir, run(dir, ['rev-parse', '--git-path', 'info/exclude']).trim());
  const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const add = ['.ril/', '.DS_Store', 'Thumbs.db'].filter((name) => !have.split(/\r?\n/).includes(name));
  if (!add.length) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${have && !have.endsWith('\n') ? '\n' : ''}${add.join('\n')}\n`);
}

// Saves everything in `dir` that the ignore files allow, and nothing outside `dir`; returns the id of the
// saved version. Creates the repository when there is none. With nothing new to save, returns the current id.
export function commitAll(dir, message) {
  if (!isRepo(dir)) run(dir, ['init', '-q']);
  ignoreLocal(dir);
  run(dir, ['rm', '-r', '--cached', '-q', '--ignore-unmatch', '--', '.ril']); // a project that tracked it before must not deadlock
  run(dir, ['add', '-A', '--', '.']);
  const current = head(dir);
  const staged = run(dir, ['diff', '--cached', '--quiet', '--', '.'], { quiet: true }) === null;
  if (!staged) {
    if (current) return current;
    throw new RilError('There is nothing in the project to save yet.', { next: 'add some files to the project, then run ril checkpoint again' });
  }
  // No pathspec on commit: `-- .` would re-stage every committed file that was since removed from the index.
  const changed = (...scope) => run(dir, ['diff', '--cached', '--name-only', '-z', ...scope]);
  if (changed() !== changed('--', '.')) {
    throw new RilError('Something outside this project folder is staged in the same git repository, and a save would include it.', { next: 'run git reset to unstage it (your files are not changed), then run ril checkpoint again' });
  }
  run(dir, ['commit', '-q', '-m', message]);
  return head(dir);
}

// Where `dir` sits inside its repository, as a prefix like "app/" ("" at the top).
function projectPrefix(dir) {
  return run(dir, ['rev-parse', '--show-prefix']).trim();
}

// The id git gives the file or folder `rel` (relative to the project) in saved version `version`, or null when it is not there.
export function objectId(dir, version, rel) {
  return run(dir, ['rev-parse', '--verify', '-q', `${version}:${projectPrefix(dir)}${rel}`], { quiet: true })?.trim() || null;
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
