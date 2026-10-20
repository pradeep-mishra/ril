// The routing block ril keeps in a project's CLAUDE.md and AGENTS.md.
// Files are handled as latin1 so every byte outside the block survives unchanged.
import fs from 'node:fs';

export const START = '<!-- ril:managed:start -->';
export const END = '<!-- ril:managed:end -->';
export const LINE =
  'This project is managed by RIL. For any request about this project (continue, fix, change, status), start with the RIL front door (/ril); it re-reads .ril/ state.';

// Returns `text` with the block added or refreshed.
export function withBlock(text) {
  const start = text.indexOf(START);
  const end = start === -1 ? -1 : text.indexOf(END, start + START.length);
  if (end !== -1) {
    const nl = text.startsWith('\r\n', start + START.length) ? '\r\n' : '\n';
    return `${text.slice(0, start)}${START}${nl}${LINE}${nl}${END}${text.slice(end + END.length)}`;
  }
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  let gap = '';
  if (text !== '') {
    const trailing = text.match(/(\r?\n)*$/)[0].split('\n').length - 1;
    gap = text.endsWith('\n') ? nl.repeat(Math.max(0, 2 - trailing)) : nl + nl;
  }
  return `${text}${gap}${START}${nl}${LINE}${nl}${END}${nl}`;
}

// Writes the block into `file` (created if absent). Returns true when the file changed.
export function writeBlock(file) {
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'latin1') : '';
  const after = withBlock(before);
  if (after === before && fs.existsSync(file)) return false;
  fs.writeFileSync(file, after, 'latin1');
  return true;
}
