// The project's tool list, .ril/tools.json: what the project needs installed and the permissions it asks for.
// The design stage writes it. The person approves one exact version of it (its hash) and ril grants nothing else.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { RilError } from './errors.mjs';
import { ownedFile } from './safe-fs.mjs';

const FIX = 'fix .ril/tools.json (the design stage writes it), then try again';
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

// Returns the first problem found in a parsed tool list, or '' when it is fine. Each permission pattern is
// checked in checkAllow, so a pattern that is not text is reported there.
function problem(r) {
  if (!isObject(r)) return 'it must hold one JSON object';
  if (!Array.isArray(r.requires)) return 'it needs a "requires" list';
  for (const [i, t] of r.requires.entries()) {
    const at = `requires item ${i + 1}`;
    if (!isObject(t)) return `${at} must be an object`;
    if (!isText(t.name)) return `${at} needs a "name"`;
    if (!isText(t.detect)) return `${at} (${t.name}) needs a "detect" command`;
    if (!isText(t.guide)) return `${at} (${t.name}) needs a plain-language "guide"`;
    if (!isText(t.reason)) return `${at} (${t.name}) needs a one-line "reason" for the person`;
    if (t.human !== undefined && typeof t.human !== 'boolean') return `${at} (${t.name}): "human" must be true or false`;
    if (t.install !== undefined && (!isObject(t.install) || !Object.values(t.install).every((c) => c === null || isText(c)))) {
      return `${at} (${t.name}): "install" must map a platform to a command or null`;
    }
  }
  if (r.allow !== undefined && !Array.isArray(r.allow)) return '"allow" must be a list of permission patterns';
  if (r.humanSteps !== undefined && !(Array.isArray(r.humanSteps) && r.humanSteps.every(isText))) return '"humanSteps" must be a list of plain sentences';
  return '';
}

// The same text for the same content: keys sorted at every level, no whitespace.
const canonical = (v) => JSON.stringify(v, (_, x) => (isObject(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

// Loads <dir>/.ril/tools.json. Returns { tools, hash }, hash being the sha256 (hex) of the canonical form.
export function loadTools(dir) {
  const file = ownedFile(dir, 'tools.json');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new RilError(`There is no tool list at ${file} yet.`, { next: 'the design stage writes it; finish that stage first' });
    throw new RilError(`Could not read ${file}.`, { next: 'check the file can be read, then try again', detail: err.message });
  }
  let tools;
  try {
    tools = JSON.parse(text.replace(/^﻿/, ''));
  } catch (err) {
    throw new RilError(`${file} is not valid JSON.`, { next: FIX, detail: err.message });
  }
  const why = problem(tools);
  if (why) throw new RilError(`${file} is not a usable tool list: ${why}.`, { next: FIX });
  return { tools, hash: crypto.createHash('sha256').update(canonical(tools)).digest('hex') };
}

const INSIDE = 'a file rule must stay inside the project';
const RULES = [
  [/^Bash$|^Bash\(\s*\*+\s*\)$/i, 'it would let any command run'],
  [/^Bash\(\s*sudo\b/i, 'it would run commands as an administrator'],
  [/^Bash\(.*\b(curl|wget)\b.*\|\s*(sudo\s+)?\w*sh\b/i, 'it would run a downloaded script'],
  [/^(Edit|Write|Read)\(\s*([\\/~]|[a-z]:)/i, `${INSIDE}; this one starts at an absolute path or the home folder`],
  [/^(Edit|Write|Read)\((.*[\\/])?\.\.([\\/)]|$)/i, `${INSIDE}; this one climbs out with ..`],
  [/^(Edit|Write)\(.*\.ril[\\/](state\.json|\.lock)/i, "ril's own state files are never allowed"],
];

// One plain line per permission pattern that ril will not grant, whoever approved it.
export function checkAllow(patterns) {
  const lines = [];
  for (const [i, p] of patterns.entries()) {
    const why = isText(p) ? RULES.find(([re]) => re.test(p.trim()))?.[1] : 'it is not text';
    if (why) lines.push(`Permission ${i + 1} (${isText(p) ? p.trim() : JSON.stringify(p)}) is refused: ${why}.`);
  }
  return lines;
}

// The sha256 in the last decision that reads exactly `Approved tools <64 hex>`, or null.
export function approvedHash(state) {
  const hashes = state.decisions.map((d) => /^Approved tools ([0-9a-f]{64})$/.exec(String(d.decision ?? '').trim())?.[1]).filter(Boolean);
  return hashes.at(-1) ?? null;
}
