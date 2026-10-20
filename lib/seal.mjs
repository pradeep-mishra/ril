// The seal: the protected paths (line 2 of verify.md) and the ids they had when a tester's work was saved.
import fs from 'node:fs';
import path from 'node:path';
import { head, objectId } from './git.mjs';
import { KIT } from './proof.mjs';

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
