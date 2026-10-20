// The rules behind a ledger record: is the kit trusted, is the evidence real, which changes are trivial.
import fs from 'node:fs';
import path from 'node:path';
import { RilError } from './errors.mjs';

// A ledger row that counts as a pass.
export const passes = (row) => row.verdict.startsWith('proven-') && row.checks >= 1 && ['clean', 'risks'].includes(row.review);

const KIT = ['.ril', 'docs', 'verification', 'verify.md'];

// 'none' when there is no kit yet, otherwise 'trusted' or 'untrusted'. The kit is trusted only when a line
// outside code fences says "Trusted: yes"; anything else (no line, "no", "maybe", bold markers) is untrusted.
export function kitTrust(dir) {
  const file = path.join(dir, ...KIT);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return 'none';
    throw new RilError(`Could not read ${file}.`, { next: 'check the file can be read, then try again', detail: err.message });
  }
  let fenced = false;
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced && /^\s*Trusted:\s*yes\b/i.test(line)) return 'trusted';
  }
  return 'untrusted';
}

const inside = (root, file) => {
  const rel = path.relative(root, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

// The evidence path as stored (relative to the project, forward slashes). Refuses anything that is not
// a non-empty ordinary file inside the project, following links to where they really point.
export function checkEvidence(dir, given, id) {
  const next = `save the evidence as a file under .ril/evidence/${id}/, then record again`;
  const root = fs.realpathSync(dir);
  let real;
  try {
    real = fs.realpathSync(path.resolve(dir, given));
  } catch {
    throw new RilError(`There is no evidence file at ${given}.`, { next });
  }
  if (real !== root && !inside(root, real)) throw new RilError(`The evidence ${given} is outside the project, so it cannot count.`, { next });
  const st = fs.statSync(real);
  if (!st.isFile()) throw new RilError(`The evidence ${given} is a folder or something else, not a file.`, { next });
  if (st.size === 0) throw new RilError(`The evidence file ${given} is empty.`, { next });
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
