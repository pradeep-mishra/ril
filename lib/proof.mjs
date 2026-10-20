// The rules behind a ledger record: is the kit trusted, is the evidence real, are the protected files as sealed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { RilError } from './errors.mjs';
import { head, objectId } from './git.mjs';
import { readText } from './safe-fs.mjs';

// A ledger row that counts as a pass.
export const passes = (row) => row.verdict.startsWith('proven-') && row.checks >= 1 && ['clean', 'risks'].includes(row.review);

const KIT = ['.ril', 'docs', 'verification', 'verify.md'];

// Only line 1 counts: "Trusted: yes (<saved version>)".
const TRUSTED = /^Trusted:[ \t]*yes(?:[ \t]+\(([^()\r\n]*)\))?[ \t]*$/i;

// A fingerprint of the kit: verify.md without its first line, then every other ordinary file in its folder (no dotfiles, links not followed), by sorted path.
export function kitHash(dir) {
  const root = path.join(dir, ...KIT.slice(0, -1));
  const rels = fs.existsSync(root) ? fs.readdirSync(root, { recursive: true }).map((n) => n.split(path.sep).join('/')).sort() : [];
  const hash = crypto.createHash('sha256');
  for (const rel of rels.filter((n) => !n.split('/').some((s) => s.startsWith('.')) && fs.lstatSync(path.join(root, n)).isFile())) {
    const body = fs.readFileSync(path.join(root, rel));
    hash.update(`${rel}\0`).update(rel === 'verify.md' ? body.toString().split(/\r?\n/).slice(1).join('\n') : body).update('\0');
  }
  return hash.digest('hex');
}

// 'none': no kit. 'untrusted': line 1 does not say yes, or no self-run is recorded for the version it names.
// 'changed': the kit differs from what that self-run saw. 'trusted' is the only state that lets more than blocked in.
export function kitTrust(dir, selfruns = []) {
  const file = path.join(dir, ...KIT);
  const text = readText(file);
  if (text === null) return 'none';
  const named = (TRUSTED.exec(text.replace(/^\uFEFF/, '').split(/\r?\n/)[0])?.[1] ?? '').trim().toLowerCase();
  const mine = /^[0-9a-f]{7,40}$/.test(named) ? selfruns.filter((r) => r.version.startsWith(named)) : [];
  return !mine.length ? 'untrusted' : mine.some((r) => r.kit === kitHash(dir)) ? 'trusted' : 'changed';
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

// The seal: the protected paths (line 2 of verify.md) and the ids they had when a tester's work was saved.

const outside = (p) => path.posix.isAbsolute(p) || /^[A-Za-z]:/.test(p) || p === '..' || p.startsWith('../');

// The paths named by "Protected: a, b" on the second line of verify.md, split into those inside the project and the rest.
export function declared(dir) {
  let text = '';
  try {
    text = fs.readFileSync(path.join(dir, ...KIT), 'utf8');
  } catch { /* no kit yet: nothing is protected */ }
  const named = /^Protected:(.*)$/i.exec(text.replace(/^﻿/, '').split(/\r?\n/)[1] ?? '')?.[1] ?? '';
  const paths = named.split(',').map((p) => p.trim().replace(/\\/g, '/')).filter(Boolean).map((p) => path.posix.normalize(p).replace(/(.)\/$/, '$1'));
  return { inside: paths.filter((p) => !outside(p)), outside: paths.filter(outside) };
}

export const idsAt = (dir, version, paths) => Object.fromEntries(paths.map((p) => [p, objectId(dir, version, p)]));

// Where the protected paths stand at `version` against the last seal: what is declared, whether any seal exists
// and which paths differ. A path that was sealed stays guarded even if it leaves the Protected line.
export function sealState(dir, version, seals = []) {
  const { inside, outside: bad } = declared(dir);
  const last = seals.at(-1);
  const guarded = [...new Set([...inside, ...Object.keys(last?.paths ?? {})])];
  const now = last ? idsAt(dir, version, guarded) : {};
  return { sealed: Boolean(last), declared: inside, outside: bad, changed: last ? guarded.filter((p) => last.paths[p] !== now[p]) : [] };
}

// One plain line when a protected path differs from the last seal at the current version, or null.
export function changedLine(dir, seals) {
  const { sealed, changed } = sealState(dir, head(dir), seals);
  return sealed && changed.length ? `Protected files changed since the last seal: ${changed.join(', ')}` : null;
}
