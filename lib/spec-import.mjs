// Reads the scenarios out of a spec written in the ril spec shape.
import { METHODS } from './schema.mjs';

const HEADING = /^#{1,6}\s/;
const SCENARIO = /^###\s+(S\d+)\s*:\s*(.*?)\s*$/;
const LOOKS_LIKE_SCENARIO = /^###\s+S\d/i;
const FIELD = /^\s*(?:[-*]\s+)?(Criterion|Proof)\s*:\s*(.*?)\s*$/i;

// Returns { scenarios: [{ id, title, criterion, method }], problems: [plain line, ...] }.
export function parseSpec(text) {
  const problems = [];
  const blocks = [];
  let block = null;
  let wrapping = false; // the criterion carries on over the next non-blank lines
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (wrapping && line.trim() && !HEADING.test(line) && !FIELD.test(line)) {
      block.criterion += ` ${line.trim()}`;
      continue;
    }
    wrapping = false;
    if (HEADING.test(line)) {
      const match = SCENARIO.exec(line);
      block = match ? { id: match[1], title: match[2], criterion: '', proof: '' } : null;
      if (block) blocks.push(block);
      else if (LOOKS_LIKE_SCENARIO.test(line)) problems.push(`The heading "${line.trim()}" should look like "### S1: a short title".`);
      continue;
    }
    const field = block && FIELD.exec(line);
    if (field) {
      const key = field[1].toLowerCase() === 'proof' ? 'proof' : 'criterion';
      if (!block[key]) {
        block[key] = field[2];
        wrapping = key === 'criterion' && Boolean(field[2]);
      }
    }
  }
  const seen = new Set();
  const scenarios = [];
  for (const b of blocks) {
    const where = b.id;
    if (seen.has(b.id)) problems.push(`${where} appears more than once in the spec.`);
    seen.add(b.id);
    if (!b.title) problems.push(`${where} has no title after the colon.`);
    if (!b.criterion) problems.push(`${where} has no "Criterion:" line saying what must be true.`);
    const method = b.proof.toLowerCase();
    if (!b.proof) problems.push(`${where} has no "Proof:" line saying how it will be proven (${METHODS.join(', ')}).`);
    else if (!METHODS.includes(method)) problems.push(`${where} says Proof: ${b.proof}, but the proof must be one of ${METHODS.join(', ')}.`);
    scenarios.push({ id: b.id, title: b.title, criterion: b.criterion, method });
  }
  if (!blocks.length && !problems.length) problems.push('The spec has no scenarios; each one starts with a heading like "### S1: a short title".');
  return { scenarios, problems };
}
