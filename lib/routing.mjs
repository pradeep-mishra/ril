// The routing block ril keeps in a project's CLAUDE.md and AGENTS.md.
// Files are handled as latin1 so every byte outside the block survives unchanged.
import fs from 'node:fs';
import { resolveInProject, writeFileAtomic } from './safe-fs.mjs';

export const START = '<!-- ril:managed:start -->';
export const END = '<!-- ril:managed:end -->';
export const LINE =
  'This project is managed by RIL. For any request about this project (continue, fix, change, status), start with the RIL front door (/ril); it re-reads .ril/ state.';

// Positions where `marker` is a whole line by itself.
function markerLines(text, marker) {
  const found = [];
  for (let at = text.indexOf(marker); at !== -1; at = text.indexOf(marker, at + 1)) {
    const after = text.slice(at + marker.length, at + marker.length + 2);
    if ((at === 0 || text[at - 1] === '\n') && (after === '' || after[0] === '\n' || after === '\r\n')) found.push(at);
  }
  return found;
}

// Returns `text` with the block added or refreshed, or null when the markers are damaged
// (anything other than no markers, or one start followed by one end).
export function withBlock(text) {
  const starts = markerLines(text, START);
  const ends = markerLines(text, END);
  if (starts.length === 0 && ends.length === 0) {
    const nl = text.includes('\r\n') ? '\r\n' : '\n';
    let gap = '';
    if (text !== '') {
      const trailing = text.match(/(\r?\n)*$/)[0].split('\n').length - 1;
      gap = text.endsWith('\n') ? nl.repeat(Math.max(0, 2 - trailing)) : nl + nl;
    }
    return `${text}${gap}${START}${nl}${LINE}${nl}${END}${nl}`;
  }
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) return null;
  const nl = text.startsWith('\r\n', starts[0] + START.length) ? '\r\n' : '\n';
  return `${text.slice(0, starts[0])}${START}${nl}${LINE}${nl}${END}${text.slice(ends[0] + END.length)}`;
}

// Puts the block into the project's `name` file (created if absent).
// Returns { changed } or { skip: <reason> } when the file was left alone.
export function writeBlock(dir, name) {
  const target = resolveInProject(dir, name);
  if (target.skip) return { skip: target.skip };
  const exists = fs.existsSync(target.file);
  const before = exists ? fs.readFileSync(target.file, 'latin1') : '';
  const after = withBlock(before);
  if (after === null) return { skip: 'its RIL block looks damaged' };
  if (after === before && exists) return { changed: false };
  writeFileAtomic(target.file, after, 'latin1');
  return { changed: true };
}
