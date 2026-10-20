// Checks an agent brief: `field: value` lines, list fields as `field:` followed by `- ` items.
import path from 'node:path';
import { ROLES } from './schema.mjs';

const LISTS = ['inputs', 'acceptance', 'touch', 'rules', 'stop'];
const FIELDS = ['role', 'unit', 'goal', 'inputs', 'acceptance', 'touch', 'rules', 'ril', 'report', 'stop'];
const MAX_LINES = 60;

const isAbsolute = (p) => path.posix.isAbsolute(p) || path.win32.isAbsolute(p);
// Without the file on disk, a path has no spaces and has a folder or an extension in it; prose does not.
const looksLikePath = (p) => !/\s/.test(p) && /[/\\.]/.test(p) && !/[,;!?]$/.test(p);

function parse(text) {
  const fields = {};
  const problems = [];
  let current = null;
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const item = /^\s*-\s+(.*\S)\s*$/.exec(line);
    if (item) {
      if (current && Array.isArray(fields[current])) fields[current].push(item[1]);
      else problems.push(`Line ${i + 1} is a list item that does not belong to a list field.`);
      return;
    }
    const field = /^([A-Za-z]+):\s*(.*?)\s*$/.exec(line);
    if (!field) {
      problems.push(`Line ${i + 1} is neither a "field: value" line nor a "- " item.`);
      return;
    }
    const [, rawName, value] = field;
    const name = rawName.toLowerCase();
    if (!FIELDS.includes(name)) problems.push(`The brief has a field called ${rawName}, which ril does not know; the fields are: ${FIELDS.join(', ')}.`);
    else if (Object.hasOwn(fields, name)) problems.push(`The ${name} field appears more than once.`);
    else if (LISTS.includes(name) && value) problems.push(`The ${name} field must be a list: "${name}:" on its own line, then one "- " item per line.`);
    current = FIELDS.includes(name) && !Object.hasOwn(fields, name) ? name : null;
    if (current) fields[name] = LISTS.includes(name) ? (value ? [value] : []) : value;
  });
  return { fields, problems };
}

// Returns the brief's fields and a list of plain problems (empty when the brief is fine).
// `exists(path)` says whether an input file is on disk; `knownUnit(name)` whether the unit names something.
export function checkBrief(text, role, { exists = () => false, knownUnit = () => true } = {}) {
  const body = text.replace(/^﻿/, '');
  const count = body.split(/\r?\n/).length - (/\r?\n$/.test(body) ? 1 : 0);
  const { fields, problems } = parse(body);
  if (count > MAX_LINES) problems.push(`The brief has ${count} lines; it must be at most ${MAX_LINES} lines.`);
  for (const name of FIELDS) {
    const value = fields[name];
    if (value === undefined) problems.push(`The brief has no ${name} field.`);
    else if (!value.length) problems.push(`The ${name} field is empty.`);
  }
  if (fields.role && !ROLES.includes(fields.role)) problems.push(`The role field says ${fields.role}; it must be one of: ${ROLES.join(', ')}.`);
  else if (fields.role && fields.role !== role) problems.push(`The role field says ${fields.role}, but the agent is being registered as ${role}.`);
  if (fields.report && fields.report !== 'agent-report') problems.push(`The report field says ${fields.report}; it must say agent-report.`);
  if (fields.rules?.length && (fields.rules.length !== 2 || !fields.rules.every(isAbsolute))) {
    problems.push('The rules field must list exactly two full paths (starting from the top of the disk): the standing rules, then the principles.');
  }
  if (fields.unit && !knownUnit(fields.unit)) problems.push(`The unit field says ${fields.unit}, but there is no unit, scenario or stage with that name.`);
  for (const input of fields.inputs ?? []) {
    if (!exists(input) && !looksLikePath(input)) problems.push(`The inputs field must list file paths only; "${input}" is not a file in the project and does not look like a file path. Name the file to read instead of describing it.`);
  }
  return { fields, problems };
}
