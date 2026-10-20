// The rules behind a ledger record: is the kit trusted, is the evidence real, which changes are trivial.
import fs from 'node:fs';
import path from 'node:path';
import { RilError } from './errors.mjs';

// A ledger row that counts as a pass.
export const passes = (row) => row.verdict.startsWith('proven-') && row.checks >= 1 && ['clean', 'risks'].includes(row.review);

const KIT = ['.ril', 'docs', 'verification', 'verify.md'];

// Only the first line counts: "Trusted: yes", optionally followed by a short note in brackets.
const TRUSTED = /^Trusted:[ \t]*yes(?:[ \t]+\([^()\r\n]*\))?[ \t]*$/i;

// 'none' when there is no kit yet, otherwise 'trusted' or 'untrusted'. Only 'trusted' lets a result other than
// blocked be recorded.
export function kitTrust(dir) {
  const file = path.join(dir, ...KIT);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return 'none';
    throw new RilError(`Could not read ${file}.`, { next: 'check the file can be read, then try again', detail: err.message });
  }
  return TRUSTED.test(text.replace(/^\uFEFF/, '').split(/\r?\n/)[0]) ? 'trusted' : 'untrusted';
}

const inside = (root, file) => {
  const rel = path.relative(root, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

// The evidence path as stored (relative to the project, forward slashes). Refuses anything that is not a
// non-empty ordinary file under <project>/.ril/evidence/, following links to where they really point.
export function checkEvidence(dir, given, id) {
  const where = `evidence belongs under .ril/evidence/${id}/<saved version>/`;
  const refuse = (why) => new RilError(`The evidence ${given} ${why}; ${where}.`, { next: `save the evidence as a file under .ril/evidence/${id}/<saved version>/, then record again` });
  const root = fs.realpathSync(dir);
  let real;
  try {
    real = fs.realpathSync(path.resolve(dir, given));
  } catch {
    throw refuse('does not exist');
  }
  if (!inside(path.join(root, '.ril', 'evidence'), real)) throw refuse('is outside .ril/evidence/, so it cannot count');
  const st = fs.statSync(real);
  if (!st.isFile()) throw refuse('is a folder or something else, not a file');
  if (st.size === 0) throw refuse('is an empty file');
  return path.relative(root, real).split(path.sep).join('/');
}

// Changes that cannot alter what a scenario does, as paths relative to the project:
// ril's own files, Markdown at the top of the project, the test and doc folders, and test files.
const TRIVIAL = [/^\.ril\//, /^[^/]+\.(md|markdown)$/i, /^(tests?|__tests__|docs?)\//i, /(^|\/)[^/]+\.(test|spec)\.[^/]+$/i];

// The changed files (relative to the top of the repository) that are not trivial for a scenario.
// `prefix` is where the project sits in the repository; anything outside it is never trivial.
export function realChanges(files, prefix, method) {
  return files.filter((file) => {
    if (!file.startsWith(prefix)) return true;
    const rel = file.slice(prefix.length);
    if (method === 'golden' && /^tests?\//i.test(rel)) return true; // the golden set lives with the tests
    return !TRIVIAL.some((re) => re.test(rel));
  }).map((file) => (file.startsWith(prefix) ? file.slice(prefix.length) : `${file} (outside the project folder)`));
}
